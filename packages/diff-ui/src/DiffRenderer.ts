import type {
  CodeOptionsMultipleThemes,
  CodeToHastOptions,
  DecorationItem,
  HighlighterGeneric,
  ShikiTransformer,
} from '@shikijs/core';
import { type ChangeObject, diffWordsWithSpace } from 'diff';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import type { BundledLanguage, BundledTheme } from 'shiki';

import { getSharedHighlighter } from './SharedHighlighter';
import type { FileMetadata, HUNK_LINE_TYPE, Hunk } from './types';
import {
  createCodeNode,
  createHunkSeparator,
  formatCSSVariablePrefix,
  setupPreNode,
} from './utils/html_render_utils';
import { parseLineType } from './utils/parseLineType';

interface ChangeHunk {
  deletionStartIndex: number;
  additionStartIndex: number;
  deletionLines: string[];
  additionLines: string[];
}

export interface DiffDecorationItem extends DecorationItem {
  type: 'additions' | 'deletions';
  // Kinda hate this API for now... need to think about it more...
  hunkIndex: number;
}

interface CodeTokenOptionsBase {
  lang?: BundledLanguage;
  defaultColor?: CodeOptionsMultipleThemes['defaultColor'];
  preferWasmHighlighter?: boolean;
  unified?: boolean;

  // FIXME(amadeus): Figure out how to incorporate these mb?
  onPreRender?(instance: DiffRenderer): unknown;
  onPostRender?(instance: DiffRenderer): unknown;
}

interface RenderHunkProps {
  hunk: Hunk;
  highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>;
  state: SharedRenderState;
  transformer: ShikiTransformer;

  codeAdditions: HTMLElement;
  codeDeletions: HTMLElement;
  codeUnified: HTMLElement;
}

interface LineInfo {
  type: 'change-deletion' | 'change-addition' | 'context';
  number: number;
}

interface SharedRenderState {
  lineInfo: Record<number, LineInfo | undefined>;
  spans: Record<number, number | undefined>;
  decorations: DecorationItem[];
}

interface CodeTokenOptionsSingleTheme extends CodeTokenOptionsBase {
  theme: BundledTheme;
  themes?: never;
}

interface CodeTokenOptionsMultiThemes extends CodeTokenOptionsBase {
  theme?: never;
  themes: { dark: BundledTheme; light: BundledTheme };
}

export type DiffRendererOptions =
  | CodeTokenOptionsSingleTheme
  | CodeTokenOptionsMultiThemes;

// Something to think about here -- might be worth not forcing a renderer to
// take a stream right off the bat, and instead allow it to get the highlighter
// and everything setup ASAP, and allow setup the ability to pass a
// ReadableStream to it...
export class DiffRenderer {
  highlighter: HighlighterGeneric<BundledLanguage, BundledTheme> | undefined;
  options: DiffRendererOptions;
  pre: HTMLPreElement | undefined;
  diff: FileMetadata | undefined;

  constructor(options: DiffRendererOptions) {
    this.options = options;
  }

  setOptions(options: DiffRendererOptions) {
    this.options = options;
    if (this.pre == null || this.diff == null) {
      return;
    }
    this.render(this.diff, this.pre);
  }

  private async initializeHighlighter() {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private queuedRenderArgs: [FileMetadata, HTMLPreElement] | undefined;

  async render(_diff: FileMetadata, _wrapper: HTMLPreElement) {
    const isSettingUp = this.queuedRenderArgs != null;
    this.queuedRenderArgs = [_diff, _wrapper];
    if (isSettingUp) {
      // TODO(amadeus): Make it so that this function can be properly
      // awaitable, maybe?
      return;
    }
    if (this.highlighter == null) {
      this.highlighter = await this.initializeHighlighter();
    }

    const [source, wrapper] = this.queuedRenderArgs;
    this.queuedRenderArgs = undefined;
    this.renderDiff(wrapper, source, this.highlighter);
  }

  private renderDiff(
    wrapper: HTMLPreElement,
    diff: FileMetadata,
    highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>
  ) {
    const { themes, theme, unified = false } = this.options;
    const split =
      unified === true
        ? false
        : diff.type === 'change' || diff.type === 'rename-changed';
    const pre = setupPreNode(
      themes != null
        ? { pre: wrapper, themes, highlighter, split }
        : { pre: wrapper, theme, highlighter, split }
    );

    this.diff = diff;
    this.pre = pre;
    const codeAdditions = createCodeNode({ columnType: 'additions' });
    const codeDeletions = createCodeNode({ columnType: 'deletions' });
    const codeUnified = createCodeNode({ columnType: 'unified' });
    const { state, transformer } = createTransformerWithState();
    let hunkIndex = 0;
    for (const hunk of diff.hunks) {
      if (hunkIndex > 0) {
        if (unified) {
          codeUnified.appendChild(createHunkSeparator());
        } else {
          codeAdditions.appendChild(createHunkSeparator());
          codeDeletions.appendChild(createHunkSeparator());
        }
      }
      this.renderHunks({
        hunk,
        highlighter,
        state,
        transformer,
        codeAdditions,
        codeDeletions,
        codeUnified,
      });
      hunkIndex++;
    }

    this.pre.innerHTML = '';
    if (codeDeletions.childNodes.length > 0) {
      this.pre.appendChild(codeDeletions);
    }
    if (codeAdditions.childNodes.length > 0) {
      this.pre.appendChild(codeAdditions);
    }
    if (codeUnified.childNodes.length > 0) {
      this.pre.appendChild(codeUnified);
    }
  }

  private createHastOptions(
    transformer: ShikiTransformer,
    decorations?: DecorationItem[]
  ): CodeToHastOptions {
    if ('theme' in this.options && this.options.theme != null) {
      return {
        theme: this.options.theme,
        cssVariablePrefix: formatCSSVariablePrefix(),
        lang: this.options.lang ?? ('text' as BundledLanguage),
        defaultColor: this.options.defaultColor ?? false,
        transformers: [transformer],
        decorations,
      };
    }

    if ('themes' in this.options) {
      return {
        themes: this.options.themes,
        cssVariablePrefix: formatCSSVariablePrefix(),
        lang: this.options.lang ?? ('text' as BundledLanguage),
        defaultColor: this.options.defaultColor ?? false,
        transformers: [transformer],
        decorations,
      };
    }
    throw new Error();
  }

  private renderHunks({
    hunk,
    highlighter,
    state,
    transformer,
    codeAdditions,
    codeDeletions,
    codeUnified,
  }: RenderHunkProps) {
    if (hunk.hunkContent == null) return;
    const { additions, deletions, unified } = this.processLines(hunk);

    if (unified.content.length > 0) {
      // Remove trailing blank line
      const content = unified.content.join('').replace(/\n$/, '');
      state.spans = {};
      state.lineInfo = unified.lineInfo;
      const nodes = highlighter.codeToHast(
        content,
        this.createHastOptions(transformer, unified.decorations)
      );
      codeUnified.insertAdjacentHTML(
        'beforeend',
        toHtml(this.getNodesToRender(nodes))
      );
    }

    if (deletions.content.length > 0) {
      // Remove trailing blank line
      const content = deletions.content.join('').replace(/\n$/, '');
      state.spans = deletions.spans;
      state.lineInfo = deletions.lineInfo;
      const nodes = highlighter.codeToHast(
        content,
        this.createHastOptions(
          transformer,
          deletions.decorations.length > 0 ? deletions.decorations : undefined
        )
      );
      codeDeletions.insertAdjacentHTML(
        'beforeend',
        toHtml(this.getNodesToRender(nodes))
      );
    }

    if (additions.content.length > 0) {
      // Remove trailing blank line
      const content = additions.content.join('').replace(/\n$/, '');
      state.spans = additions.spans;
      state.lineInfo = additions.lineInfo;
      const nodes = highlighter.codeToHast(
        content,
        this.createHastOptions(
          transformer,
          additions.decorations.length > 0 ? additions.decorations : undefined
        )
      );
      codeAdditions.insertAdjacentHTML(
        'beforeend',
        toHtml(this.getNodesToRender(nodes))
      );
    }
  }

  private processLines(hunk: Hunk) {
    const { unified = false } = this.options;

    const additionContent: string[] = [];
    const additionLineInfo: Record<number, LineInfo | undefined> = {};
    const additionSpans: Record<number, number> = {};
    let additionLineIndex = 1;
    let additionLineNumber = hunk.additionStart;
    let additionGroupSize = 0;

    const deletionContent: string[] = [];
    const deletionLineInfo: Record<number, LineInfo | undefined> = {};
    const deletionSpans: Record<number, number> = {};
    let deletionLineIndex = 1;
    let deletionLineNumber = hunk.deletedStart;
    let deletionGroupSize = 0;

    const unifiedContent: string[] = [];
    const unifiedInfo: Record<number, LineInfo | undefined> = {};
    let unifiedLineIndex = 1;

    const diffGroups: ChangeHunk[] = [];
    let currentChangeGroup: ChangeHunk | undefined;

    function addToChangeGroup(type: 'addition' | 'deletion', line: string) {
      if (currentChangeGroup == null) {
        currentChangeGroup = {
          // In unified layout, deletionLineIndex and additionLineIndex won't
          // be usable, and we will have to compute start indexes as we are
          // iterating
          deletionStartIndex: unified ? -1 : deletionLineIndex - 1,
          additionStartIndex: unified ? -1 : additionLineIndex - 1,
          deletionLines: [],
          additionLines: [],
        };
        diffGroups.push(currentChangeGroup);
      }
      if (unified) {
        if (
          type === 'deletion' &&
          currentChangeGroup.deletionStartIndex === -1
        ) {
          currentChangeGroup.deletionStartIndex = unifiedLineIndex - 1;
        }
        if (
          type === 'addition' &&
          currentChangeGroup.additionStartIndex === -1
        ) {
          currentChangeGroup.additionStartIndex = unifiedLineIndex - 1;
        }
      }
      if (type === 'addition') {
        currentChangeGroup.additionLines.push(line);
      } else {
        currentChangeGroup.deletionLines.push(line);
      }
    }

    function createSpanIfNecessary() {
      if (
        !unified &&
        lastType !== 'context' &&
        lastType != null &&
        additionGroupSize !== deletionGroupSize
      ) {
        if (additionGroupSize > deletionGroupSize) {
          deletionSpans[deletionLineIndex - 1] =
            additionGroupSize - deletionGroupSize;
        } else if (deletionGroupSize > additionGroupSize) {
          additionSpans[additionLineIndex - 1] =
            deletionGroupSize - additionGroupSize;
        }
      }
    }

    let lastType: HUNK_LINE_TYPE | undefined;
    for (const rawLine of hunk.hunkContent ?? []) {
      const { line, type } = parseLineType(rawLine);
      if (type === 'context') {
        createSpanIfNecessary();
      }
      if (type === 'context') {
        currentChangeGroup = undefined;
        additionGroupSize = 0;
        deletionGroupSize = 0;
        if (unified) {
          unifiedContent.push(line);
          unifiedInfo[unifiedLineIndex] = {
            type: 'context',
            number: additionLineNumber,
          };
          unifiedLineIndex++;
        } else {
          additionContent.push(line);
          deletionContent.push(line);
          additionLineInfo[additionLineIndex] = {
            type: 'context',
            number: additionLineNumber,
          };
          deletionLineInfo[deletionLineIndex] = {
            type: 'context',
            number: deletionLineNumber,
          };
          additionLineIndex++;
          deletionLineIndex++;
        }

        additionLineNumber++;
        deletionLineNumber++;
      } else if (type === 'deletion') {
        addToChangeGroup('deletion', line);
        if (unified) {
          unifiedContent.push(line);
          unifiedInfo[unifiedLineIndex] = {
            type: 'change-deletion',
            number: deletionLineNumber,
          };
          unifiedLineIndex++;
        } else {
          deletionContent.push(line);
          deletionLineInfo[deletionLineIndex] = {
            type: 'change-deletion',
            number: deletionLineNumber,
          };
          deletionGroupSize++;
          deletionLineIndex++;
        }
        deletionLineNumber++;
      } else if (type === 'addition') {
        addToChangeGroup('addition', line);
        if (unified) {
          unifiedContent.push(line);
          unifiedInfo[unifiedLineIndex] = {
            type: 'change-addition',
            number: additionLineNumber,
          };
          unifiedLineIndex++;
        } else {
          additionContent.push(line);
          additionLineInfo[additionLineIndex] = {
            type: 'change-addition',
            number: additionLineNumber,
          };
          additionGroupSize++;
          additionLineIndex++;
        }
        additionLineNumber++;
      }

      lastType = type;
    }
    createSpanIfNecessary();
    const { unifiedDecorations, deletionDecorations, additionDecorations } =
      this.parseDecorations(diffGroups);
    return {
      additions: {
        content: additionContent,
        lineInfo: additionLineInfo,
        spans: additionSpans,
        decorations: additionDecorations,
      },
      deletions: {
        content: deletionContent,
        lineInfo: deletionLineInfo,
        spans: deletionSpans,
        decorations: deletionDecorations,
      },
      unified: {
        content: unifiedContent,
        lineInfo: unifiedInfo,
        decorations: unifiedDecorations,
      },
    };
  }

  private parseDecorations(diffGroups: ChangeHunk[]) {
    const { unified = false } = this.options;
    const unifiedDecorations: DecorationItem[] = [];
    const additionDecorations: DecorationItem[] = [];
    const deletionDecorations: DecorationItem[] = [];
    for (const group of diffGroups) {
      const len = Math.min(
        group.additionLines.length,
        group.deletionLines.length
      );
      for (let i = 0; i < len; i++) {
        const deletionLine = group.deletionLines[i];
        const additionLine = group.additionLines[i];
        if (deletionLine == null || additionLine == null) {
          break;
        }
        // Lets skep running diffs on super long lines because it's probably
        // expensive and hard to follow
        if (deletionLine.length > 1000 || additionLine.length > 1000) {
          continue;
        }
        const lineDiff = diffWordsWithSpace(deletionLine, additionLine);
        const deletionSpans: [0 | 1, string][] = [];
        const additionSpans: [0 | 1, string][] = [];
        for (const item of lineDiff) {
          if (!item.added && !item.removed) {
            pushOrJoinSpan(item, deletionSpans, true);
            pushOrJoinSpan(item, additionSpans, true);
          } else if (item.removed) {
            pushOrJoinSpan(item, deletionSpans);
          } else {
            pushOrJoinSpan(item, additionSpans);
          }
        }
        let spanIndex = 0;
        for (const span of additionSpans) {
          if (span[0] === 1) {
            (unified ? unifiedDecorations : additionDecorations).push(
              createDiffSpanDecoration({
                line: group.additionStartIndex + i,
                spanStart: spanIndex,
                spanLength: span[1].length,
              })
            );
          }
          spanIndex += span[1].length;
        }
        spanIndex = 0;
        for (const span of deletionSpans) {
          if (span[0] === 1) {
            (unified ? unifiedDecorations : deletionDecorations).push(
              createDiffSpanDecoration({
                line: group.deletionStartIndex + i,
                spanStart: spanIndex,
                spanLength: span[1].length,
              })
            );
          }
          spanIndex += span[1].length;
        }
      }
    }
    return { unifiedDecorations, deletionDecorations, additionDecorations };
  }

  private getNodesToRender(nodes: Root) {
    let firstChild: RootContent | Element | Root | null = nodes.children[0];
    while (firstChild != null) {
      if (firstChild.type === 'element' && firstChild.tagName === 'code') {
        return firstChild.children;
      }
      if ('children' in firstChild) {
        firstChild = firstChild.children[0];
      } else {
        firstChild = null;
      }
    }
    return nodes;
  }

  private getHighlighterOptions() {
    const {
      lang,
      themes: _themes,
      theme,
      preferWasmHighlighter,
    } = this.options;
    const langs: BundledLanguage[] = [];
    if (lang != null) {
      langs.push(lang);
    }
    const themes: BundledTheme[] = [];
    if (theme != null) {
      themes.push(theme);
    } else if (themes) {
      themes.push(_themes.dark);
      themes.push(_themes.light);
    }
    return { langs, themes, preferWasmHighlighter };
  }
}

interface CreateDiffSpanDecorationProps {
  line: number;
  spanStart: number;
  spanLength: number;
}

function createDiffSpanDecoration({
  line,
  spanStart,
  spanLength,
}: CreateDiffSpanDecorationProps): DecorationItem {
  return {
    start: { line, character: spanStart },
    end: { line, character: spanStart + spanLength },
    properties: { 'data-diff-span': '' },
    alwaysWrap: true,
  };
}

function convertLine(
  node: Element,
  line: number,
  state: SharedRenderState
): ElementContent {
  // We need to convert the current line to a div but keep all the decorations
  // that may be applied
  node.tagName = 'div';
  node.properties['data-column-content'] = '';
  // NOTE(amadeus): We need to push newline characters into empty rows or else
  // copy/pasta will have issues
  if (node.children.length === 0) {
    node.children.push({ type: 'text', value: '\n' });
  }
  const children = [node];
  const lineInfo = state.lineInfo[line];
  if (lineInfo == null) {
    throw new Error(`convertLine: line ${line}, contains no state.lineInfo`);
  }
  // NOTE(amadeus): This should probably be based on a setting
  children.unshift({
    tagName: 'div',
    type: 'element',
    properties: { 'data-column-number': '' },
    children: [{ type: 'text', value: `${lineInfo.number}` }],
  });
  return {
    tagName: 'div',
    type: 'element',
    properties: {
      ['data-line']: `${lineInfo.number}`,
      ['data-line-type']: lineInfo.type,
    },
    children,
  };
}

function findCodeElement(nodes: Root | Element): Element | undefined {
  let firstChild: RootContent | Element | Root | null = nodes.children[0];
  while (firstChild != null) {
    if (firstChild.type === 'element' && firstChild.tagName === 'code') {
      return firstChild;
    }
    if ('children' in firstChild) {
      firstChild = firstChild.children[0];
    } else {
      firstChild = null;
    }
  }
  return undefined;
}

function createEmptyRowBuffer(size: number): Element {
  return {
    tagName: 'div',
    type: 'element',
    properties: {
      'data-buffer': '',
      style: `grid-row: span ${size};min-height:calc(${size} * 1lh)`,
    },
    children: [],
  };
}

function createTransformerWithState(): {
  state: SharedRenderState;
  transformer: ShikiTransformer;
} {
  const state: SharedRenderState = {
    spans: {},
    lineInfo: {},
    decorations: [],
  };
  return {
    state,
    transformer: {
      line(hast) {
        // Remove the default class
        delete hast.properties.class;
        return hast;
      },
      pre(pre) {
        // NOTE(amadeus): This kinda sucks -- basically we can't apply our
        // line node changes until AFTER decorations have been applied
        const code = findCodeElement(pre);
        const children: ElementContent[] = [];
        if (code != null) {
          let index = 1;
          for (const node of code.children) {
            if (node.type !== 'element') {
              continue;
            }
            // Do we need to inject an empty span above the first line line?
            if (index === 1 && state.spans[0] != null) {
              children.push(createEmptyRowBuffer(state.spans[0]));
            }
            children.push(convertLine(node, index, state));
            const span = state.spans[index];
            if (span != null) {
              children.push(createEmptyRowBuffer(span));
            }

            index++;
          }
          code.children = children;
        }
        return pre;
      },
    },
  };
}

// For diff decoration spans, we want to be sure that if there is a single
// white-space gap between diffs that we join them together into a longer diff span.
// Spans are basically just a tuple - 1 means the content should be
// highlighted, 0 means it should not, we still need to the span data to figure
// out span positions
function pushOrJoinSpan(
  item: ChangeObject<string>,
  arr: [0 | 1, string][],
  isNeutral: boolean = false
) {
  const lastItem = arr[arr.length - 1];
  if (lastItem == null || item.value === '\n') {
    arr.push([isNeutral ? 0 : 1, item.value]);
    return;
  }
  const isLastItemNeutral = lastItem[0] === 0;
  if (
    isNeutral === isLastItemNeutral ||
    // If we have a single space neutral item, lets join it to a previously
    // space non-neutral item to avoid single space gaps
    (isNeutral && item.value.length === 1 && !isLastItemNeutral)
  ) {
    lastItem[1] += item.value;
    return;
  }
  arr.push([isNeutral ? 0 : 1, item.value]);
}
