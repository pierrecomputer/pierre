import { CodeToTokenTransformStream, type RecallToken } from './shiki-stream';
import type {
  HighlighterGeneric,
  StringLiteralUnion,
  ThemedToken,
} from '@shikijs/core';
import {
  createRow,
  createSpanFromToken,
  createWrapperNodes,
} from './utils/html_render_utils';
import type { BundledLanguage, BundledTheme } from 'shiki';
import { queueRender } from './UnversialRenderer';
import { getSharedHighlighter } from './SharedHighlighter';

interface CodeTokenOptionsBase {
  lang: BundledLanguage;
  defaultColor?: StringLiteralUnion<'light' | 'dark'> | 'light-dark()' | false;
}

interface CodeTokenOptionsSingleTheme extends CodeTokenOptionsBase {
  theme: BundledTheme;
  themes?: never;
}

interface CodeTokenOptionsMultiThemes extends CodeTokenOptionsBase {
  theme?: never;
  themes: { dark: BundledTheme; light: BundledTheme };
}

type CodeRendererOptions =
  | CodeTokenOptionsSingleTheme
  | CodeTokenOptionsMultiThemes;

export class CodeRenderer {
  highlighter: HighlighterGeneric<BundledLanguage, BundledTheme> | undefined;
  options: CodeRendererOptions;
  stream: ReadableStream<string>;
  private pre: HTMLPreElement = document.createElement('pre');
  private code: HTMLElement = document.createElement('code');

  constructor(stream: ReadableStream<string>, options: CodeRendererOptions) {
    this.stream = stream;
    this.options = options;
  }

  async setup(wrapper: HTMLElement) {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    const { pre, code } = createWrapperNodes(this.highlighter);
    this.pre = pre;
    wrapper.appendChild(this.pre);
    this.code = code;
    this.stream
      .pipeThrough(
        new CodeToTokenTransformStream({
          highlighter: this.highlighter,
          allowRecalls: true,
          ...this.options,
        })
      )
      .pipeTo(
        new WritableStream({
          start() {},
          close() {},
          abort() {},
          write: this.handleWrite,
        })
      );
  }

  currentLineIndex = 1;
  currentLineElement: HTMLElement | undefined;
  handleWrite = async (token: ThemedToken | RecallToken) => {
    this.queuedTokens.push(token);
    queueRender(this.render);
  };

  private queuedTokens: (ThemedToken | RecallToken)[] = [];
  render = () => {
    const isScrolledToBottom =
      this.pre.scrollTop + this.pre.clientHeight >= this.pre.scrollHeight - 1;

    for (const token of this.queuedTokens) {
      if ('recall' in token) {
        if (this.currentLineElement == null) {
          throw new Error(
            'Whoopsie, no current line element, shouldnt be possible to get here'
          );
        }
        if (token.recall > this.currentLineElement.childNodes.length) {
          throw new Error(
            'Whoopsie, recal is larger than the line... probably a bug...'
          );
        }
        for (let i = 0; i < token.recall; i++) {
          this.currentLineElement.lastChild?.remove();
        }
      } else {
        const span = createSpanFromToken(token);
        if (this.currentLineElement == null) {
          this.createLine();
        }
        this.currentLineElement?.appendChild(span);
        if (token.content === '\n') {
          this.currentLineIndex++;
          this.createLine();
        }
      }
    }

    if (isScrolledToBottom) {
      this.pre.scrollTop = this.pre.scrollHeight;
    }

    this.queuedTokens.length = 0;
  };

  private createLine() {
    const { row, content } = createRow(this.currentLineIndex);
    this.code.appendChild(row);
    this.currentLineElement = content;
  }

  private getHighlighterOptions() {
    const { lang, themes: _themes, theme } = this.options;
    const langs: BundledLanguage[] = [lang];
    const themes: BundledTheme[] = [];
    if (theme != null) {
      themes.push(theme);
    } else if (themes) {
      themes.push(_themes.dark);
      themes.push(_themes.light);
    }
    return { langs, themes };
  }
}
