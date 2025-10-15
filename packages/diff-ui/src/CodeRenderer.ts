import {
  CodeToTokenTransformStream,
  type RecallToken,
} from '@pierre/shiki-stream';

import { getSharedHighlighter } from './SharedHighlighter';
import { queueRender } from './UniversalRenderer';
import type {
  BaseCodeProps,
  PJSHighlighter,
  PJSThemeNames,
  SupportedLanguages,
  ThemeModes,
  ThemedToken,
  ThemesType,
} from './types';
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
  theme: PJSThemeNames;
  themes?: never;
}

interface CodeTokenOptionsMultiThemes extends CodeTokenOptionsBase {
  theme?: never;
  themes: ThemesType;
}

export type CodeRendererOptions =
  | CodeTokenOptionsSingleTheme
  | CodeTokenOptionsMultiThemes;

export class CodeRenderer {
  private highlighter: PJSHighlighter | undefined;
  options: CodeRendererOptions;
  private stream: ReadableStream<string> | undefined;
  private fileContainer: HTMLElement | undefined;
  pre: HTMLPreElement | undefined;
  private code: HTMLElement | undefined;

  constructor(options: CodeRendererOptions) {
    this.options = options;
    this.currentLineIndex = this.options.startingLineIndex ?? 1;
  }

  setThemeMode(themeMode: ThemeModes) {
    if ((this.options.themeMode ?? 'system') === themeMode) {
      return;
    }
    this.options = { ...this.options, themeMode };

    // Update pre element theme mode
    if (this.pre != null) {
      switch (themeMode) {
        case 'system':
          delete this.pre.dataset.themeMode;
          break;
        case 'light':
        case 'dark':
          this.pre.dataset.themeMode = themeMode;
          break;
      }
    }
  }

  private async initializeHighlighter() {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private queuedSetupArgs:
    | [ReadableStream<string> | string, HTMLElement]
    | undefined;
  async setup(
    _source: ReadableStream<string> | string,
    _wrapper: HTMLElement
  ) {
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

    // Convert string to ReadableStream if needed
    const stream =
      typeof source === 'string'
        ? new ReadableStream<string>({
            start(controller) {
              controller.enqueue(source);
              controller.close();
            },
          })
        : source;

    this.setupStream(stream, wrapper, this.highlighter);
  }

  private setupStream(
    stream: ReadableStream<string>,
    wrapper: HTMLElement,
    highlighter: PJSHighlighter
  ) {
    const {
      themes,
      theme,
      overflow = 'scroll',
      themeMode = 'system',
    } = this.options;
    const fileContainer = this.getOrCreateFileContainer();
    if (fileContainer.parentElement == null) {
      wrapper.appendChild(fileContainer);
    }
    this.pre ??= document.createElement('pre');
    if (this.pre.parentElement == null) {
      fileContainer.shadowRoot?.appendChild(this.pre);
    }
    const pre = setWrapperProps({
      pre: this.pre,
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
    const themes: PJSThemeNames[] = [];
    if (theme != null) {
      themes.push(theme);
    } else if (_themes != null) {
      themes.push(_themes.dark);
      themes.push(_themes.light);
    }
    return { langs, themes, preferWasmHighlighter };
  }

  private getOrCreateFileContainer(fileContainer?: HTMLElement) {
    if (
      (fileContainer != null && fileContainer === this.fileContainer) ||
      (fileContainer == null && this.fileContainer != null)
    ) {
      return this.fileContainer;
    }
    this.fileContainer =
      fileContainer ?? document.createElement('pjs-container');
    return this.fileContainer;
  }
}
