import { CodeToTokenTransformStream, type RecallToken } from './shiki-stream';
import type {
  HighlighterGeneric,
  StringLiteralUnion,
  ThemedToken,
} from '@shikijs/core';
import {
  createRow,
  createSpanFromToken,
  setupWrapperNodes,
} from './utils/html_render_utils';
import type { BundledLanguage, BundledTheme } from 'shiki';
import { queueRender } from './UnversialRenderer';
import { getSharedHighlighter } from './SharedHighlighter';

interface CodeTokenOptionsBase {
  lang: BundledLanguage;
  defaultColor?: StringLiteralUnion<'light' | 'dark'> | 'light-dark()' | false;
  preferWasmHighlighter?: boolean;
  startingLineIndex?: number;

  onPreRender?(instance: CodeRenderer): unknown;
  onPostRender?(instance: CodeRenderer): unknown;

  onStreamStart?(controller: WritableStreamDefaultController): unknown;
  onStreamWrite?(token: ThemedToken | RecallToken): unknown;
  onStreamClose?(): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onStreamAbort?(reason: any): unknown;
}

interface CodeTokenOptionsSingleTheme extends CodeTokenOptionsBase {
  theme: BundledTheme;
  themes?: never;
}

interface CodeTokenOptionsMultiThemes extends CodeTokenOptionsBase {
  theme?: never;
  themes: { dark: BundledTheme; light: BundledTheme };
}

export type CodeRendererOptions =
  | CodeTokenOptionsSingleTheme
  | CodeTokenOptionsMultiThemes;

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

  private queuedSetupArgs: [ReadableStream<string>, HTMLPreElement] | undefined;
  async setup(_stream: ReadableStream<string>, _wrapper: HTMLPreElement) {
    const isSettingUp = this.queuedSetupArgs != null;
    this.queuedSetupArgs = [_stream, _wrapper];
    if (isSettingUp) {
      // TODO(amadeus): Make it so that this function can be properly
      // awaitable, maybe?
      return;
    }
    if (this.highlighter == null) {
      this.highlighter = await this.initializeHighlighter();
    }

    const [stream, wrapper] = this.queuedSetupArgs;
    const { onStreamStart, onStreamClose, onStreamAbort, themes, theme } =
      this.options;
    const { pre, code } = setupWrapperNodes(
      themes != null
        ? {
            pre: wrapper,
            themes,
            highlighter: this.highlighter,
          }
        : {
            pre: wrapper,
            theme,
            highlighter: this.highlighter,
          }
    );

    this.queuedSetupArgs = undefined;
    this.pre = pre;
    this.code = code;
    if (this.stream != null) {
      // Should we be doing this?
      this.stream.cancel();
    }
    this.stream = stream;
    this.stream
      .pipeThrough(
        new CodeToTokenTransformStream({
          highlighter: this.highlighter,
          allowRecalls: true,
          cssVariablePrefix: '--pjs-',
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
    const langs: BundledLanguage[] = [lang];
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
