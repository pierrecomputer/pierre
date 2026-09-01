import { DEFAULT_THEMES, DIFFS_TAG_NAME } from '../constants';
import {
  customHighlighterOf,
  loadHighlighter,
  type RenderersHighlighter,
} from '../highlighter/resolve_highlighter';
import {
  dequeueRender,
  queueRender,
} from '../managers/UniversalRenderingManager';
import { CodeToTokenTransformStream, type RecallToken } from '../shiki-stream';
import type {
  AppliedThemeStyleCache,
  BaseCodeOptions,
  DiffsHighlighter,
  DiffsThemeNames,
  SupportedLanguages,
  ThemedToken,
  ThemesType,
  ThemeTypes,
} from '../types';
import { createSpanFromToken } from '../utils/createSpanNodeFromToken';
import { wrapThemeCSS } from '../utils/cssWrappers';
import { formatCSSVariablePrefix } from '../utils/formatCSSVariablePrefix';
import { getHighlighterOptions } from '../utils/getHighlighterOptions';
import { getHighlighterThemeStyles } from '../utils/getHighlighterThemeStyles';
import { getOrCreateCodeNode } from '../utils/getOrCreateCodeNode';
import { upsertHostThemeStyle } from '../utils/hostTheme';
import { getMeasuredScrollbarGutter } from '../utils/scrollbarGutter';
import { setPreNodeProperties } from '../utils/setWrapperNodeProps';

export interface FileStreamOptions extends BaseCodeOptions {
  lang?: SupportedLanguages;
  startingLineIndex?: number;

  onPreRender?(instance: FileStream): unknown;
  onPostRender?(instance: FileStream): unknown;

  onStreamStart?(controller: WritableStreamDefaultController): unknown;
  onStreamWrite?(token: ThemedToken | RecallToken): unknown;
  onStreamClose?(): unknown;
  onStreamAbort?(reason: unknown): unknown;
}

let instanceId = -1;

// Chunk-coalescing bounds for custom tokenizer streams: hold pending text
// until a frame passed since the last tokenizer push, unless this many bytes
// already piled up (a synchronous burst should not wait on wall time).
const STREAM_COALESCE_MS = 16;
const STREAM_COALESCE_BYTES = 4096;

export class FileStream {
  readonly __id: string = `file-stream:${++instanceId}`;

  private highlighter: RenderersHighlighter | undefined;
  private stream: ReadableStream<string> | undefined;
  private abortController: AbortController | undefined;
  private fileContainer: HTMLElement | undefined;
  private pre: HTMLPreElement | undefined;
  private code: HTMLElement | undefined;
  private gutterElement: HTMLElement | undefined;
  private contentElement: HTMLElement | undefined;
  private themeCSSStyle: HTMLStyleElement | undefined;
  private appliedThemeCSS: AppliedThemeStyleCache | undefined;
  private currentRowCount = 0;

  constructor(public options: FileStreamOptions = { theme: DEFAULT_THEMES }) {
    this.currentLineIndex = this.options.startingLineIndex ?? 1;
  }

  cleanUp(): void {
    dequeueRender(this.render);
    this.abortController?.abort();
    this.abortController = undefined;
  }

  setThemeType(themeType: ThemeTypes): void {
    if ((this.options.themeType ?? 'system') === themeType) {
      return;
    }
    this.options = { ...this.options, themeType };
    if (
      typeof this.options.theme === 'string' ||
      this.fileContainer == null ||
      this.appliedThemeCSS == null
    ) {
      return;
    }
    this.applyThemeState(
      this.fileContainer,
      this.appliedThemeCSS.themeStyles,
      themeType,
      this.appliedThemeCSS.baseThemeType
    );
  }

  private async initializeHighlighter(): Promise<RenderersHighlighter> {
    this.highlighter = await loadHighlighter(
      getHighlighterOptions(this.options.lang, this.options)
    );
    return this.highlighter;
  }

  private queuedSetupArgs: [ReadableStream<string>, HTMLElement] | undefined;
  async setup(
    _source: ReadableStream<string>,
    _wrapper: HTMLElement
  ): Promise<void> {
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

    const stream = source;

    this.setupStream(stream, wrapper, this.highlighter);
  }

  private setupStream(
    stream: ReadableStream<string>,
    wrapper: HTMLElement,
    highlighter: RenderersHighlighter
  ): void {
    const {
      disableLineNumbers = false,
      overflow = 'scroll',
      theme = DEFAULT_THEMES,
      themeType = 'system',
    } = this.options;
    const fileContainer = this.getOrCreateFileContainer();
    if (fileContainer.parentElement == null) {
      wrapper.appendChild(fileContainer);
    }
    this.pre ??= document.createElement('pre');
    if (this.pre.parentElement == null) {
      fileContainer.shadowRoot?.appendChild(this.pre);
    }
    const baseThemeType =
      typeof theme === 'string' ? highlighter.getTheme(theme).type : undefined;
    const themeStyles = getHighlighterThemeStyles({ theme, highlighter });
    this.applyThemeState(fileContainer, themeStyles, themeType, baseThemeType);
    const pre = setPreNodeProperties(this.pre, {
      type: 'file',
      diffIndicators: 'none',
      disableBackground: true,
      disableLineNumbers,
      overflow,
      split: false,
      totalLines: 0,
    });
    pre.textContent = '';

    this.pre = pre;
    this.code = getOrCreateCodeNode({ code: this.code, pre });
    // Re-setup reuses the code node, but clearing the pre above detached it;
    // getOrCreateCodeNode only appends nodes it created itself.
    if (this.code.parentElement !== pre) {
      pre.appendChild(this.code);
    }
    // tokens queued by a previous run describe DOM the wipe just discarded
    this.queuedTokens.length = 0;
    this.gutterElement = undefined;
    this.contentElement = undefined;
    this.currentRowCount = 0;
    this.currentLineElement = undefined;
    this.currentLineIndex = this.options.startingLineIndex ?? 1;
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { onStreamStart, onStreamClose, onStreamAbort } = this.options;
    // Cancel the prior source so upstream producers stop generating tokens.
    // Swallow AbortError / locked-stream rejections since we're tearing down.
    this.stream?.cancel().catch(() => {});
    this.stream = stream;
    this.stream
      // tokenizeTimeLimit: 0 — never trade silently-wrong token colors for
      // latency; see renderFileWithHighlighter for the full rationale.
      .pipeThrough(this.createTokenStream(highlighter, theme))
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
        }),
        { signal: this.abortController.signal }
      )
      .catch((error) => {
        // Ignore AbortError - it's expected when cleaning up
        if (error.name !== 'AbortError') {
          console.error('FileStream pipe error:', error);
        }
      });
  }

  /**
   * The token stream for the active highlighter: the pre-existing shiki
   * grammar-state stream (with recalls) when shiki is active, or a
   * `CodeHighlighter.TokenizeStream` wrapper for custom highlighters.
   */
  private createTokenStream(
    highlighter: RenderersHighlighter,
    theme: DiffsThemeNames | ThemesType
  ): TransformStream<string, ThemedToken | RecallToken> {
    // Derive the tokenizer from the highlighter this stream captured during
    // setup, not the mutable registration: a setHighlighter call in between
    // must not pair one implementation's theme CSS with another's tokens.
    const custom = customHighlighterOf(highlighter);
    const options = {
      ...this.options,
      ...(typeof theme === 'string' ? { theme } : { themes: theme }),
      defaultColor: false as const,
      cssVariablePrefix: formatCSSVariablePrefix('token'),
      tokenizeTimeLimit: 0,
    };
    if (custom != null) {
      // Stream over the highlighter's TokenizeStream: the same token protocol
      // CodeToTokenTransformStream emits, minus recalls — the tokenizer holds
      // the trailing incomplete line back until its newline (or the stream
      // end) arrives, so no token ever needs re-emitting.
      //
      // Tokenizers may re-scan their whole buffer on every push (Chamele's
      // non-TypeScript lexers currently do), which makes one push per tiny
      // chunk quadratic over the stream.
      // Chunks are therefore coalesced: push once a newline is pending and
      // either a frame's worth of time passed (slow streams keep
      // line-at-a-time latency) or enough bytes piled up (synchronous bursts
      // tokenize in few large pushes instead of thousands of small ones).
      const tokenizer = new custom.TokenizeStream(options);
      let pending = '';
      let lastPushTime = 0;
      let coalesceTimer: ReturnType<typeof setTimeout> | undefined;
      const enqueueCompletedLines = (
        controller: TransformStreamDefaultController<ThemedToken>
      ) => {
        if (coalesceTimer !== undefined) {
          clearTimeout(coalesceTimer);
          coalesceTimer = undefined;
        }
        lastPushTime = performance.now();
        const lines = tokenizer.pushCode(pending);
        pending = '';
        // every line pushCode returns was newline-terminated in the source
        for (const line of lines) {
          for (const token of line) {
            controller.enqueue(token);
          }
          controller.enqueue({ content: '\n', offset: 0 });
        }
      };
      return new TransformStream<string, ThemedToken>({
        transform(chunk, controller) {
          pending += chunk;
          if (!pending.includes('\n')) {
            return;
          }
          const elapsed = performance.now() - lastPushTime;
          if (
            pending.length < STREAM_COALESCE_BYTES &&
            elapsed < STREAM_COALESCE_MS
          ) {
            // Hold the completed line for the rest of the coalescing window,
            // but schedule the flush: if the source pauses, the line must
            // still paint without waiting for the next chunk or close.
            coalesceTimer ??= setTimeout(() => {
              coalesceTimer = undefined;
              try {
                if (pending.includes('\n')) {
                  enqueueCompletedLines(controller);
                }
              } catch {
                // the stream was closed or errored since scheduling
              }
            }, STREAM_COALESCE_MS - elapsed);
            return;
          }
          enqueueCompletedLines(controller);
        },
        flush(controller) {
          if (coalesceTimer !== undefined) {
            clearTimeout(coalesceTimer);
            coalesceTimer = undefined;
          }
          if (pending !== '') {
            enqueueCompletedLines(controller);
          }
          const lines = tokenizer.end();
          lines.forEach((line, index) => {
            for (const token of line) {
              controller.enqueue(token);
            }
            if (index < lines.length - 1) {
              controller.enqueue({ content: '\n', offset: 0 });
            }
          });
        },
      });
    }
    return new CodeToTokenTransformStream({
      ...options,
      highlighter: highlighter as DiffsHighlighter,
      allowRecalls: true,
    });
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
    const { gutter, content } = this.getOrCreateStreamColumns();
    const gutterFragment = document.createDocumentFragment();
    const contentFragment = document.createDocumentFragment();
    for (const token of this.queuedTokens) {
      if ('recall' in token) {
        if (this.currentLineElement == null) {
          throw new Error(
            'FileStream.render: no current line element, shouldnt be possible to get here'
          );
        }
        if (token.recall > this.currentLineElement.childNodes.length) {
          throw new Error(
            `FileStream.render: Token recall exceed the current line, there's probably a bug...`
          );
        }
        for (let i = 0; i < token.recall; i++) {
          this.currentLineElement.lastChild?.remove();
        }
      } else {
        const span = createSpanFromToken(token);
        if (this.currentLineElement == null) {
          const { gutterLine, contentLine } = this.createLine();
          gutterFragment.appendChild(gutterLine);
          contentFragment.appendChild(contentLine);
        }
        this.currentLineElement?.appendChild(span);
        if (token.content === '\n') {
          this.currentLineIndex++;
          const { gutterLine, contentLine } = this.createLine();
          gutterFragment.appendChild(gutterLine);
          contentFragment.appendChild(contentLine);
        }
      }
    }
    if (gutterFragment.childNodes.length > 0) {
      gutter.appendChild(gutterFragment);
    }
    if (contentFragment.childNodes.length > 0) {
      content.appendChild(contentFragment);
    }
    this.queuedTokens.length = 0;
    this.options.onPostRender?.(this);
  };

  private getOrCreateStreamColumns(): {
    gutter: HTMLElement;
    content: HTMLElement;
  } {
    if (this.code == null) {
      throw new Error('FileStream: expected code element to exist');
    }
    if (this.gutterElement != null && this.contentElement != null) {
      return { gutter: this.gutterElement, content: this.contentElement };
    }
    const gutter = document.createElement('div');
    gutter.dataset.gutter = '';
    const content = document.createElement('div');
    content.dataset.content = '';
    this.code.appendChild(gutter);
    this.code.appendChild(content);
    this.gutterElement = gutter;
    this.contentElement = content;
    return { gutter, content };
  }

  private updateRowSpan(): void {
    if (this.gutterElement != null) {
      this.gutterElement.style.gridRow = `span ${this.currentRowCount}`;
    }
    if (this.contentElement != null) {
      this.contentElement.style.gridRow = `span ${this.currentRowCount}`;
    }
  }

  private createLine(): { gutterLine: HTMLElement; contentLine: HTMLElement } {
    const lineNumber = this.currentLineIndex;
    const lineIndex = `${lineNumber - 1}`;
    const gutterLine = document.createElement('div');
    gutterLine.dataset.columnNumber = `${lineNumber}`;
    gutterLine.dataset.lineType = 'context';
    gutterLine.dataset.lineIndex = lineIndex;

    const numberContent = document.createElement('span');
    numberContent.dataset.lineNumberContent = '';
    numberContent.textContent = `${lineNumber}`;
    gutterLine.appendChild(numberContent);

    const contentLine = document.createElement('div');
    contentLine.dataset.line = `${lineNumber}`;
    contentLine.dataset.lineType = 'context';
    contentLine.dataset.lineIndex = lineIndex;

    this.currentRowCount += 1;
    this.updateRowSpan();
    this.currentLineElement = contentLine;
    return { gutterLine, contentLine };
  }

  private getOrCreateFileContainer(fileContainer?: HTMLElement): HTMLElement {
    if (
      (fileContainer != null && fileContainer === this.fileContainer) ||
      (fileContainer == null && this.fileContainer != null)
    ) {
      return this.fileContainer;
    }
    if (
      this.fileContainer != null &&
      fileContainer != null &&
      fileContainer !== this.fileContainer
    ) {
      this.themeCSSStyle = undefined;
      this.appliedThemeCSS = undefined;
    }
    this.fileContainer =
      fileContainer ?? document.createElement(DIFFS_TAG_NAME);
    return this.fileContainer;
  }

  private applyThemeState(
    container: HTMLElement,
    themeStyles: string,
    themeType: ThemeTypes,
    baseThemeType?: 'light' | 'dark'
  ): void {
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const effectiveThemeType = baseThemeType ?? themeType;
    const currentTheme = this.options.theme ?? DEFAULT_THEMES;
    const theme =
      typeof currentTheme === 'string' ? currentTheme : { ...currentTheme };
    const scrollbarGutter = getMeasuredScrollbarGutter(shadowRoot);
    if (
      this.themeCSSStyle?.parentNode === shadowRoot &&
      this.appliedThemeCSS?.themeStyles === themeStyles &&
      this.appliedThemeCSS.themeType === effectiveThemeType &&
      this.appliedThemeCSS.scrollbarGutter === scrollbarGutter
    ) {
      this.appliedThemeCSS.theme = theme;
      return;
    }
    this.themeCSSStyle = upsertHostThemeStyle({
      shadowRoot,
      currentNode: this.themeCSSStyle,
      themeCSS: wrapThemeCSS(themeStyles, effectiveThemeType, scrollbarGutter),
    });
    this.appliedThemeCSS =
      this.themeCSSStyle != null
        ? {
            theme,
            themeStyles,
            themeType: effectiveThemeType,
            baseThemeType,
            scrollbarGutter,
          }
        : undefined;
  }
}
