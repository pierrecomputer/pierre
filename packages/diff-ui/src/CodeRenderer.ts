import {
  CodeToTokenTransformStream,
  type RecallToken,
} from '@pierre/shiki-stream';
import type {
  BundledLanguage,
  BundledTheme,
  HighlighterGeneric,
  ThemedToken,
} from 'shiki';

import { getSharedHighlighter } from './SharedHighlighter';
import { queueRender } from './UnversialRenderer';
import type { BaseCodeProps, SupportedLanguages } from './types';
import {
  createCodeNode,
  createRow,
  createSpanFromToken,
  formatCSSVariablePrefix,
  setWrapperProps,
} from './utils/html_render_utils';

interface CodeTokenOptionsBase extends BaseCodeProps {
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

export type CodeRendererOptions =
  | CodeTokenOptionsSingleTheme
  | CodeTokenOptionsMultiThemes;

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

  private async initializeHighlighter() {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private queuedSetupArgs: [ReadableStream<string>, HTMLPreElement] | undefined;
  async setup(_source: ReadableStream<string>, _wrapper: HTMLPreElement) {
    const isSettingUp = this.queuedSetupArgs != null;
    this.queuedSetupArgs = [_source, _wrapper];
    if (isSettingUp) {
      // TODO(amadeus): Make it so that this function can be properly
      // awaitable, maybe?
      return;
    }
    this.highlighter ??= await this.initializeHighlighter();

    const [source, wrapper] = this.queuedSetupArgs;
    this.queuedSetupArgs = undefined;
    this.setupStream(source, wrapper, this.highlighter);
  }

  private setupStream(
    stream: ReadableStream<string>,
    wrapper: HTMLPreElement,
    highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>
  ) {
    const {
      themes,
      theme,
      overflow = 'scroll',
      themeMode = 'system',
    } = this.options;
    const pre = setWrapperProps({
      pre: wrapper,
      split: false,
      theme,
      themes,
      highlighter,
      wrap: overflow === 'wrap',
      themeMode,
      diffIndicators: 'none',
      disableBackground: true,
    });
    pre.innerHTML = '';

    this.pre = pre;
    this.code = createCodeNode({ pre });
    if (this.stream != null) {
      // Should we be doing this?
      void this.stream.cancel();
    }
    const { onStreamStart, onStreamClose, onStreamAbort } = this.options;
    this.stream = stream;
    void this.stream
      .pipeThrough(
        new CodeToTokenTransformStream({
          ...this.options,
          highlighter,
          allowRecalls: true,
          cssVariablePrefix: formatCSSVariablePrefix(),
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
  private handleWrite = (token: ThemedToken | RecallToken) => {
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
  private render = () => {
    this.options.onPreRender?.(this);
    const linesToAppend: HTMLElement[] = [];
    for (const token of this.queuedTokens) {
      if ('recall' in token) {
        if (this.currentLineElement == null) {
          throw new Error(
            'CodeRenderer.render: no current line element, shouldnt be possible to get here'
          );
        }
        if (token.recall > this.currentLineElement.childNodes.length) {
          throw new Error(
            `CodeRenderer.render: Token recall exceed the current line, there's probably a bug...`
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
    const langs: SupportedLanguages[] = [];
    if (lang != null) {
      langs.push(lang);
    }
    const themes: BundledTheme[] = [];
    if (theme != null) {
      themes.push(theme);
    } else if (themes != null) {
      themes.push(_themes.dark);
      themes.push(_themes.light);
    }
    return { langs, themes, preferWasmHighlighter };
  }
}
