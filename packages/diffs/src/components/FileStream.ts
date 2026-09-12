import { isSupportedLanguage, StreamTokenizer } from '@pierre/highlights';

import { DEFAULT_THEMES, DIFFS_TAG_NAME } from '../constants';
import { getHighlightsTheme } from '../highlighter/getHighlightsTheme';
import { getSharedHighlighter } from '../highlighter/shared_highlighter';
import {
  dequeueRender,
  queueRender,
} from '../managers/UniversalRenderingManager';
import type {
  AppliedThemeStyleCache,
  BaseCodeOptions,
  DiffsHighlighter,
  SupportedLanguages,
  ThemedToken,
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

/** Remove provisional tokens from the unfinished streamed line. */
export interface FileStreamRecallToken {
  recall: number;
}

export interface FileStreamOptions extends BaseCodeOptions {
  lang?: SupportedLanguages;
  startingLineIndex?: number;

  onPreRender?(instance: FileStream): unknown;
  onPostRender?(instance: FileStream): unknown;

  onStreamStart?(controller: WritableStreamDefaultController): unknown;
  onStreamWrite?(token: ThemedToken | FileStreamRecallToken): unknown;
  onStreamClose?(): unknown;
  onStreamAbort?(reason: unknown): unknown;
}

let instanceId = -1;

export class FileStream {
  readonly __id: string = `file-stream:${++instanceId}`;

  private highlighter: DiffsHighlighter | undefined;
  private stream: ReadableStream<string> | undefined;
  private streamTokenizer: StreamTokenizer | undefined;
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
    this.streamTokenizer?.dispose();
    this.streamTokenizer = undefined;
    this.queuedTokens.length = 0;
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

  private async initializeHighlighter(): Promise<DiffsHighlighter> {
    this.highlighter = await getSharedHighlighter(
      getHighlighterOptions(this.options)
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
    highlighter: DiffsHighlighter
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
    const baseThemeType =
      typeof theme === 'string'
        ? getHighlightsTheme(highlighter.getTheme(theme)).appearance === 'light'
          ? 'light'
          : 'dark'
        : undefined;
    const themeStyles = getHighlighterThemeStyles({ theme, highlighter });
    this.applyThemeState(fileContainer, themeStyles, themeType, baseThemeType);
    if (this.pre.parentElement == null) {
      fileContainer.shadowRoot?.appendChild(this.pre);
    }

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
    this.code = getOrCreateCodeNode({ pre });
    this.gutterElement = undefined;
    this.contentElement = undefined;
    dequeueRender(this.render);
    this.queuedTokens.length = 0;
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
    this.streamTokenizer?.dispose();
    const language = this.options.lang ?? 'text';
    const tokenizer = new StreamTokenizer({
      lang: isSupportedLanguage(language) ? language : 'text',
      ...(typeof theme === 'string'
        ? { theme: getHighlightsTheme(highlighter.getTheme(theme)) }
        : {
            themes: {
              dark: getHighlightsTheme(highlighter.getTheme(theme.dark)),
              light: getHighlightsTheme(highlighter.getTheme(theme.light)),
            },
          }),
      defaultColor: false,
      cssVariablePrefix: formatCSSVariablePrefix('token'),
      tokenizeMaxLineLength: this.options.tokenizeMaxLineLength,
    });
    this.streamTokenizer = tokenizer;
    let pending = '';
    let offset = 0;
    let provisional = false;
    this.stream
      .pipeThrough(
        new TransformStream<string, ThemedToken | FileStreamRecallToken>({
          transform(chunk, controller) {
            if (provisional) controller.enqueue({ recall: 1 });
            pending += chunk;
            const lines = tokenizer.pushCode(chunk);
            const completedEnd = pending.lastIndexOf('\n') + 1;
            const completed = pending.slice(0, completedEnd);
            let lineIndex = 0;
            for (const match of completed.matchAll(/\r\n|\r|\n/g)) {
              for (const token of lines[lineIndex]) controller.enqueue(token);
              lineIndex++;
              controller.enqueue({
                content: match[0],
                offset: offset + match.index,
              });
            }
            offset += completedEnd;
            pending = pending.slice(completedEnd);
            provisional = pending !== '';
            // Keep new chunks visible while the native tokenizer retains the
            // unfinished line. Completed lines replace this provisional text.
            if (provisional) controller.enqueue({ content: pending, offset });
          },
          flush(controller) {
            if (provisional) controller.enqueue({ recall: 1 });
            const lines = tokenizer.end();
            let lineIndex = 0;
            for (const match of pending.matchAll(/\r\n|\r|\n/g)) {
              for (const token of lines[lineIndex++]) controller.enqueue(token);
              controller.enqueue({
                content: match[0],
                offset: offset + match.index,
              });
            }
            for (const token of lines[lineIndex]) controller.enqueue(token);
            if (offset === 0 && pending === '')
              controller.enqueue({ content: '', offset: 0 });
          },
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
        }),
        { signal: this.abortController.signal }
      )
      .finally(() => tokenizer.dispose())
      .catch((error) => {
        // Ignore AbortError - it's expected when cleaning up
        if (error.name !== 'AbortError') {
          console.error('FileStream pipe error:', error);
        }
      });
  }

  private queuedTokens: (ThemedToken | FileStreamRecallToken)[] = [];
  private handleWrite = (token: ThemedToken | FileStreamRecallToken) => {
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
        if (/^(?:\r\n|\r|\n)$/.test(token.content)) {
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
