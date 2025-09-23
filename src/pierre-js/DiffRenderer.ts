import type { Root, Element, RootContent, ElementContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import type {
  CodeOptionsMultipleThemes,
  DecorationItem,
  HighlighterGeneric,
  ShikiTransformer,
  CodeToHastOptions,
} from '@shikijs/core';
import {
  createHunkSeparator,
  createCodeNode,
  setupPreNode,
  formatCSSVariablePrefix,
} from './utils/html_render_utils';
import type { BundledLanguage, BundledTheme } from 'shiki';
import { getSharedHighlighter } from './SharedHighlighter';
import type { FileMetadata, Hunk, HUNK_LINE_TYPE } from './types';
import { SPLIT_WITH_NEWLINES } from './constants';
import { parseLineType } from './utils/parseLineType';

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
  deletionDecorations: DiffDecorationItem[] | undefined;
  additionDecorations: DiffDecorationItem[] | undefined;

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

  private queuedRenderArgs:
    | [FileMetadata, HTMLPreElement, DiffDecorationItem[] | undefined]
    | undefined;

  async render(
    _diff: FileMetadata,
    _wrapper: HTMLPreElement,
    _decorations?: DiffDecorationItem[]
  ) {
    const isSettingUp = this.queuedRenderArgs != null;
    this.queuedRenderArgs = [_diff, _wrapper, _decorations];
    if (isSettingUp) {
      // TODO(amadeus): Make it so that this function can be properly
      // awaitable, maybe?
      return;
    }
    if (this.highlighter == null) {
      this.highlighter = await this.initializeHighlighter();
    }

    const [source, wrapper, decorations] = this.queuedRenderArgs;
    this.queuedRenderArgs = undefined;
    this.renderDiff(wrapper, source, this.highlighter, decorations);
  }

  private renderDiff(
    wrapper: HTMLPreElement,
    diff: FileMetadata,
    highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>,
    decorations?: DiffDecorationItem[]
  ) {
    const { themes, theme, unified = false } = this.options;
    const split =
      unified === true
        ? false
        : diff.type === 'changed' || diff.type === 'renamed-changed';
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
    const decorationSet = new Set(decorations);
    for (const hunk of diff.hunks) {
      if (hunkIndex > 0) {
        if (unified) {
          codeUnified.appendChild(createHunkSeparator());
        } else {
          codeAdditions.appendChild(createHunkSeparator());
          codeDeletions.appendChild(createHunkSeparator());
        }
      }
      const additionDecorations: DiffDecorationItem[] = [];
      const deletionDecorations: DiffDecorationItem[] = [];
      for (const decoration of decorationSet) {
        if (decoration.hunkIndex !== hunkIndex) continue;
        if (decoration.type === 'additions') {
          additionDecorations.push(decoration);
        } else {
          deletionDecorations.push(decoration);
        }
        decorationSet.delete(decoration);
      }
      this.renderHunks({
        hunk,
        highlighter,
        state,
        transformer,
        additionDecorations:
          additionDecorations.length > 0 ? additionDecorations : undefined,
        deletionDecorations:
          deletionDecorations.length > 0 ? deletionDecorations : undefined,
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
    additionDecorations,
    deletionDecorations,
    codeAdditions,
    codeDeletions,
    codeUnified,
  }: RenderHunkProps) {
    if (hunk.hunkContent == null) return;
    const { unified = false } = this.options;

    const additionLineInfo: Record<number, LineInfo | undefined> = {};
    const additionSpans: Record<number, number> = {};
    let additionLineIndex = 1;
    let additionLineNumber = hunk.additionStart;
    let additionContent: string | undefined;
    let additionGroupSize = 0;

    const deletionLineInfo: Record<number, LineInfo | undefined> = {};
    const deletionSpans: Record<number, number> = {};
    let deletionLineIndex = 1;
    let deletionLineNumber = hunk.deletedStart;
    let deletionGroupSize = 0;
    let deletionContent: string | undefined;

    const unifiedInfo: Record<number, LineInfo | undefined> = {};
    let unifiedContent: string | undefined;
    let unifiedLineIndex = 1;

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
    for (const rawLine of hunk.hunkContent.split(SPLIT_WITH_NEWLINES)) {
      const { line, type } = parseLineType(rawLine);
      if (type === 'context') {
        createSpanIfNecessary();
      }
      if (type === 'context') {
        additionGroupSize = 0;
        deletionGroupSize = 0;
        if (unified) {
          unifiedContent = (unifiedContent ?? '') + line;
          unifiedInfo[unifiedLineIndex] = {
            type: 'context',
            number: additionLineNumber,
          };
          unifiedLineIndex++;
        } else {
          additionContent = (additionContent ?? '') + line;
          deletionContent = (deletionContent ?? '') + line;
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
        if (unified) {
          unifiedContent = (unifiedContent ?? '') + line;
          unifiedInfo[unifiedLineIndex] = {
            type: 'change-deletion',
            number: deletionLineNumber,
          };
          unifiedLineIndex++;
        } else {
          deletionContent = (deletionContent ?? '') + line;
          deletionLineInfo[deletionLineIndex] = {
            type: 'change-deletion',
            number: deletionLineNumber,
          };
          deletionGroupSize++;
          deletionLineIndex++;
        }
        deletionLineNumber++;
      } else if (type === 'addition') {
        if (unified) {
          unifiedContent = (unifiedContent ?? '') + line;
          unifiedInfo[unifiedLineIndex] = {
            type: 'change-addition',
            number: additionLineNumber,
          };
          unifiedLineIndex++;
        } else {
          additionContent = (additionContent ?? '') + line;
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

    if (unifiedContent != null) {
      // Remove trailing blank line
      unifiedContent = unifiedContent.replace(/\n$/, '');
      state.spans = {};
      state.lineInfo = unifiedInfo;
      const nodes = highlighter.codeToHast(
        unifiedContent,
        this.createHastOptions(transformer, deletionDecorations)
      );
      codeUnified.insertAdjacentHTML(
        'beforeend',
        toHtml(this.getNodesToRender(nodes))
      );
    }

    if (deletionContent != null) {
      // Remove trailing blank line
      deletionContent = deletionContent.replace(/\n$/, '');
      state.spans = deletionSpans;
      state.lineInfo = deletionLineInfo;
      const nodes = highlighter.codeToHast(
        deletionContent,
        this.createHastOptions(transformer, deletionDecorations)
      );
      codeDeletions.insertAdjacentHTML(
        'beforeend',
        toHtml(this.getNodesToRender(nodes))
      );
    }

    if (additionContent != null) {
      // Remove trailing blank line
      additionContent = additionContent.replace(/\n$/, '');
      state.spans = additionSpans;
      state.lineInfo = additionLineInfo;
      const nodes = highlighter.codeToHast(
        additionContent,
        this.createHastOptions(transformer, additionDecorations)
      );
      codeAdditions.insertAdjacentHTML(
        'beforeend',
        toHtml(this.getNodesToRender(nodes))
      );
    }
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
    throw new Error('Whoopsie');
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
