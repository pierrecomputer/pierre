import { CodeToTokenTransformStream, type RecallToken } from './shiki-stream';
import type { Root, Element, RootContent, ElementContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import type {
  CodeOptionsMultipleThemes,
  DecorationItem,
  HighlighterGeneric,
  ShikiTransformer,
  ThemedToken,
} from '@shikijs/core';
import {
  createHunkSeparator,
  createRow,
  createSpanFromToken,
  formatCSSVariablePrefix,
  createCodeNode,
  setupPreNode,
} from './utils/html_render_utils';
import type { BundledLanguage, BundledTheme } from 'shiki';
import { queueRender } from './UnversialRenderer';
import { getSharedHighlighter } from './SharedHighlighter';
import type { FileMetadata, Hunk, HunkTypes, LinesHunk } from './types';

interface CodeToHastBase {
  lang: BundledLanguage;
  defaultColor?: CodeOptionsMultipleThemes['defaultColor'];
  transformers: ShikiTransformer[];
  decorations?: DecorationItem[];
}

interface CodeToHastTheme extends CodeToHastBase {
  theme: BundledTheme;
  themes?: never;
}

interface CodeToHastThemes extends CodeToHastBase {
  theme?: never;
  themes: { dark: BundledTheme; light: BundledTheme };
}

interface CodeTokenOptionsBase {
  lang?: BundledLanguage;
  defaultColor?: CodeOptionsMultipleThemes['defaultColor'];
  preferWasmHighlighter?: boolean;
  startingLineIndex?: number;

  onPreRender?(instance: CodeRenderer): unknown;
  onPostRender?(instance: CodeRenderer): unknown;

  onStreamStart?(controller: WritableStreamDefaultController): unknown;
  onStreamWrite?(token: ThemedToken | RecallToken): unknown;
  onStreamClose?(): unknown;
  onStreamAbort?(reason: unknown): unknown;
}

interface CodeTokenOptionsSingleTheme extends CodeTokenOptionsBase {
  theme: BundledTheme;
  themes?: never;
}

interface CodeTokenOptionsMultiThemes extends CodeTokenOptionsBase {
  theme?: never;
  themes: { dark: BundledTheme; light: BundledTheme };
}

interface RenderHunkProps {
  hunk: Hunk;
  highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>;
  state: SharedRenderState;
  codeDeletions: HTMLElement;
  codeAdditions: HTMLElement;
  transformer: ShikiTransformer;
}

export type CodeRendererOptions =
  | CodeTokenOptionsSingleTheme
  | CodeTokenOptionsMultiThemes;

interface SharedRenderState {
  startingLine: number;
  lineTypes: Record<number, HunkTypes>;
  spans: Record<number, number | undefined>;
  decorations: DecorationItem[];
}

// Something to think about here -- might be worth not forcing a renderer to
// take a stream right off the bat, and instead allow it to get the highlighter
// and everything setup ASAP, and allow setup the ability to pass a
// ReadableStream to it...
export class CodeRenderer {
  highlighter: HighlighterGeneric<BundledLanguage, BundledTheme> | undefined;
  options: CodeRendererOptions;
  stream: ReadableStream<string> | undefined;
  pre: HTMLPreElement | undefined;
  code: HTMLElement | undefined;

  constructor(options: CodeRendererOptions) {
    this.options = options;
    this.currentLineIndex = this.options.startingLineIndex ?? 1;
  }

  async initializeHighlighter() {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private queuedSetupArgs:
    | [ReadableStream<string> | FileMetadata, HTMLPreElement]
    | undefined;
  async setup(
    _source: ReadableStream<string> | FileMetadata,
    _wrapper: HTMLPreElement
  ) {
    const isSettingUp = this.queuedSetupArgs != null;
    this.queuedSetupArgs = [_source, _wrapper];
    if (isSettingUp) {
      // TODO(amadeus): Make it so that this function can be properly
      // awaitable, maybe?
      return;
    }
    if (this.highlighter == null) {
      this.highlighter = await this.initializeHighlighter();
    }

    const [source, wrapper] = this.queuedSetupArgs;
    this.queuedSetupArgs = undefined;
    if (source instanceof ReadableStream) {
      this.setupStream(wrapper, source, this.highlighter);
    } else {
      this.setupDiff(wrapper, source, this.highlighter);
    }
  }

  setupDiff(
    wrapper: HTMLPreElement,
    diff: FileMetadata,
    highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>
  ) {
    const { themes, theme } = this.options;
    const splitView =
      diff.type === 'changed' || diff.type === 'renamed-changed';
    const pre = setupPreNode(
      themes != null
        ? { pre: wrapper, themes, highlighter, splitView }
        : { pre: wrapper, theme, highlighter, splitView }
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
    let hasRenderedHunk = false;
    for (const hunk of diff.hunks) {
      if (!hasRenderedHunk) {
        hasRenderedHunk = true;
      } else {
        codeAdditions.appendChild(createHunkSeparator());
        codeDeletions.appendChild(createHunkSeparator());
      }
      this.renderHunk({
        hunk,
        highlighter,
        state,
        codeAdditions,
        codeDeletions,
        transformer,
      });
    }
    if (codeDeletions.childNodes.length > 0) {
      this.pre.appendChild(codeDeletions);
    }
    if (codeAdditions.childNodes.length > 0) {
      this.pre.appendChild(codeAdditions);
    }
  }

  createHastOptions(
    transformer: ShikiTransformer,
    decorations?: DecorationItem[]
  ): CodeToHastTheme | CodeToHastThemes {
    // REFERENCE CODE
    // decorations: [
    //   { start: 4, end: 105, properties: { 'data-lol': 'wot' } },
    // ],
    if ('theme' in this.options && this.options.theme != null) {
      return {
        theme: this.options.theme,
        lang: this.options.lang ?? ('text' as BundledLanguage),
        defaultColor: this.options.defaultColor,
        transformers: [transformer],
        decorations,
      };
    }

    if ('themes' in this.options) {
      return {
        themes: this.options.themes,
        lang: this.options.lang ?? ('text' as BundledLanguage),
        defaultColor: this.options.defaultColor,
        transformers: [transformer],
        decorations,
      };
    }
    throw new Error();
  }

  renderHunk({
    hunk,
    highlighter,
    state,
    codeAdditions,
    codeDeletions,
    transformer,
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
        this.createHastOptions(transformer)
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
        this.createHastOptions(transformer)
      );
      codeAdditions.insertAdjacentHTML(
        'beforeend',
        toHtml(this.getNodesToRender(nodes))
      );
    }
  }

  getNodesToRender(nodes: Root) {
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

  setupStream(
    wrapper: HTMLPreElement,
    stream: ReadableStream<string>,
    highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>
  ) {
    const { themes, theme } = this.options;
    const pre = setupPreNode(
      themes != null
        ? { pre: wrapper, themes, highlighter, splitView: false }
        : { pre: wrapper, theme, highlighter, splitView: false }
    );

    this.pre = pre;
    this.code = createCodeNode({ pre });
    if (this.stream != null) {
      // Should we be doing this?
      this.stream.cancel();
    }
    const { onStreamStart, onStreamClose, onStreamAbort } = this.options;
    this.stream = stream;
    this.stream
      .pipeThrough(
        new CodeToTokenTransformStream({
          highlighter,
          allowRecalls: true,
          cssVariablePrefix: formatCSSVariablePrefix(),
          ...this.options,
        })
      )
      .pipeTo(
        new WritableStream({
          start(controller) {
            onStreamStart?.(controller);
          },
          close() {
            onStreamClose?.();
          },
          abort(reason) {
            onStreamAbort?.(reason);
          },
          write: this.handleWrite,
        })
      );
  }

  private queuedTokens: (ThemedToken | RecallToken)[] = [];
  handleWrite = async (token: ThemedToken | RecallToken) => {
    // If we've recalled tokens we haven't rendered yet, we can just yeet them
    // and never apply them
    if ('recall' in token && this.queuedTokens.length >= token.recall) {
      this.queuedTokens.length = this.queuedTokens.length - token.recall;
    } else {
      this.queuedTokens.push(token);
    }
    queueRender(this.render);
    this.options.onStreamWrite?.(token);
  };

  private currentLineIndex: number;
  private currentLineElement: HTMLElement | undefined;
  render = () => {
    this.options.onPreRender?.(this);
    const linesToAppend: HTMLElement[] = [];
    for (const token of this.queuedTokens) {
      if ('recall' in token) {
        if (this.currentLineElement == null) {
          throw new Error(
            'Whoopsie, no current line element, shouldnt be possible to get here'
          );
        }
        if (token.recall > this.currentLineElement.childNodes.length) {
          throw new Error(
            'Whoopsie, recall is larger than the line... probably a bug...'
          );
        }
        for (let i = 0; i < token.recall; i++) {
          this.currentLineElement.lastChild?.remove();
        }
      } else {
        const span = createSpanFromToken(token);
        if (this.currentLineElement == null) {
          linesToAppend.push(this.createLine());
        }
        this.currentLineElement?.appendChild(span);
        if (token.content === '\n') {
          this.currentLineIndex++;
          linesToAppend.push(this.createLine());
        }
      }
    }
    for (const line of linesToAppend) {
      this.code?.appendChild(line);
    }
    this.queuedTokens.length = 0;
    this.options.onPostRender?.(this);
  };

  private createLine() {
    const { row, content } = createRow(this.currentLineIndex);
    this.currentLineElement = content;
    return row;
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
  // We want to conver the default node for a line into a div and we don't want
  // to include any shiki baggage by default, so we just re-create it to be
  // safe
  node = {
    type: 'element',
    tagName: 'div',
    properties: {
      ['data-column-content']: '',
    },
    children: node.children,
  };
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
    properties: { 'data-buffer': '', style: `grid-row: span ${size}` },
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
      code(code) {
        code.properties['data-code'] = '';
        return code;
      },
      pre(pre) {
        // FIXME(amadeus): We should probably not do this...
        pre.properties['data-theme'] = 'dark';
        delete pre.properties.class;
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
