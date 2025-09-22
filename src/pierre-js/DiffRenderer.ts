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
import type { FileMetadata, Hunk, HunkTypes, LinesHunk } from './types';

export interface DiffDecorationItem extends DecorationItem {
  type: 'additions' | 'deletions';
  // Kinda hate this API for now... need to think about it more...
  hunkIndex: number;
}

interface CodeTokenOptionsBase {
  lang?: BundledLanguage;
  defaultColor?: CodeOptionsMultipleThemes['defaultColor'];
  preferWasmHighlighter?: boolean;

  // FIXME(amadeus): Figure out how to incorporate these mb?
  onPreRender?(instance: DiffRenderer): unknown;
  onPostRender?(instance: DiffRenderer): unknown;
}

interface RenderHunkProps {
  hunk: Hunk;
  highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>;
  state: SharedRenderState;
  codeDeletions: HTMLElement;
  codeAdditions: HTMLElement;
  transformer: ShikiTransformer;
  deletionDecorations: DiffDecorationItem[] | undefined;
  additionDecorations: DiffDecorationItem[] | undefined;
}

interface SharedRenderState {
  startingLine: number;
  lineTypes: Record<number, HunkTypes>;
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

  constructor(options: DiffRendererOptions) {
    this.options = options;
  }

  private async initializeHighlighter() {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private queuedSetupArgs:
    | [FileMetadata, HTMLPreElement, DiffDecorationItem[] | undefined]
    | undefined;
  async setup(
    _source: FileMetadata,
    _wrapper: HTMLPreElement,
    _decorations?: DiffDecorationItem[]
  ) {
    const isSettingUp = this.queuedSetupArgs != null;
    this.queuedSetupArgs = [_source, _wrapper, _decorations];
    if (isSettingUp) {
      // TODO(amadeus): Make it so that this function can be properly
      // awaitable, maybe?
      return;
    }
    if (this.highlighter == null) {
      this.highlighter = await this.initializeHighlighter();
    }

    const [source, wrapper, decorations] = this.queuedSetupArgs;
    this.queuedSetupArgs = undefined;
    this.setupDiff(wrapper, source, this.highlighter, decorations);
  }

  private setupDiff(
    wrapper: HTMLPreElement,
    diff: FileMetadata,
    highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>,
    decorations?: DiffDecorationItem[]
  ) {
    const { themes, theme } = this.options;
    const split = diff.type === 'changed' || diff.type === 'renamed-changed';
    const pre = setupPreNode(
      themes != null
        ? { pre: wrapper, themes, highlighter, split }
        : { pre: wrapper, theme, highlighter, split }
    );

    this.pre = pre;
    const codeAdditions = createCodeNode({ columnType: 'additions' });
    const codeDeletions = createCodeNode({ columnType: 'deletions' });
    const { state, transformer } = createTransformerWithState();
    const element = document.createElement('div');
    element.dataset.fileInfo = '';
    if (diff.hunks.length === 0) {
      element.textContent = `RENAME ONLY: ${diff.prevName} -> ${diff.name}`;
    } else {
      element.textContent = `${diff.type.toUpperCase()}: ${diff.prevName != null ? `${diff.prevName} -> ` : ''}${diff.name}`;
    }
    this.pre.parentNode?.insertBefore(element, this.pre);
    let hunkIndex = 0;
    let hasRenderedHunk = false;
    const decorationSet = new Set(decorations);
    for (const hunk of diff.hunks) {
      if (!hasRenderedHunk) {
        hasRenderedHunk = true;
      } else {
        codeAdditions.appendChild(createHunkSeparator());
        codeDeletions.appendChild(createHunkSeparator());
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
      this.renderHunk({
        hunk,
        highlighter,
        state,
        codeAdditions,
        codeDeletions,
        transformer,
        additionDecorations:
          additionDecorations.length > 0 ? additionDecorations : undefined,
        deletionDecorations:
          deletionDecorations.length > 0 ? deletionDecorations : undefined,
      });
      hunkIndex++;
    }
    if (codeDeletions.childNodes.length > 0) {
      this.pre.appendChild(codeDeletions);
    }
    if (codeAdditions.childNodes.length > 0) {
      this.pre.appendChild(codeAdditions);
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

  private renderHunk({
    hunk,
    highlighter,
    state,
    codeAdditions,
    codeDeletions,
    transformer,
    additionDecorations,
    deletionDecorations,
  }: RenderHunkProps) {
    let lineIndex = 0;
    let opposingLines = hunk.additionLines;
    const processLines = (linesHunk: LinesHunk, linesHunkIndex: number) => {
      // Figure out if the opposite group of lines is taller than our current
      // one, if so we'll have to add a spanner node to fill the space
      const oppositeHunk = opposingLines[linesHunkIndex];
      if (
        oppositeHunk != null &&
        oppositeHunk.lines.length > linesHunk.lines.length
      ) {
        state.spans[lineIndex + linesHunk.lines.length] =
          oppositeHunk.lines.length - linesHunk.lines.length;
      }
      // Get a mapping of the line type (change or context) and convert into a
      // string
      let processedLines = '';
      let index = lineIndex;
      for (const line of linesHunk.lines) {
        state.lineTypes[index + 1] = linesHunk.type;
        processedLines += line;
        index++;
      }
      lineIndex += linesHunk.lines.length;
      return processedLines;
    };
    if (hunk.deletedLines.length > 0) {
      state.startingLine = hunk.deletedStart - 1;
      state.lineTypes = {};
      state.spans = {};
      lineIndex = 0;
      const deletions = hunk.deletedLines
        .map(processLines)
        .join('')
        .replace(/\n$/, '');
      const nodes = highlighter.codeToHast(
        deletions,
        this.createHastOptions(transformer, deletionDecorations)
      );
      codeDeletions.insertAdjacentHTML(
        'beforeend',
        toHtml(this.getNodesToRender(nodes))
      );
    }

    if (hunk.additionLines.length > 0) {
      opposingLines = hunk.deletedLines;
      state.lineTypes = {};
      state.spans = {};
      lineIndex = 0;
      const additions = hunk.additionLines
        .map(processLines)
        .join('')
        .replace(/\n$/, '');
      state.startingLine = hunk.additionStart - 1;
      const nodes = highlighter.codeToHast(
        additions,
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
  const lineNr = state.startingLine + line;
  // NOTE(amadeus): This should probably be based on a setting
  children.unshift({
    tagName: 'div',
    type: 'element',
    properties: { 'data-column-number': '' },
    children: [{ type: 'text', value: `${lineNr}` }],
  });
  return {
    tagName: 'div',
    type: 'element',
    properties: {
      ['data-line']: `${lineNr}`,
      ['data-line-type']: state.lineTypes[line],
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
    startingLine: 0,
    lineTypes: {},
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
