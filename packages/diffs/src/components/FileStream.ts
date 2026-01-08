import { DEFAULT_THEMES, DIFFS_TAG_NAME } from '../constants';
import { getSharedHighlighter } from '../highlighter/shared_highlighter';
import { queueRender } from '../managers/UniversalRenderingManager';
import { CodeToTokenTransformStream, type RecallToken } from '../shiki-stream';
import type {
  BaseCodeOptions,
  DiffsHighlighter,
  SupportedLanguages,
  ThemeTypes,
  ThemedToken,
} from '../types';
import { createRowNodes } from '../utils/createRowNodes';
import { createSpanFromToken } from '../utils/createSpanNodeFromToken';
import { formatCSSVariablePrefix } from '../utils/formatCSSVariablePrefix';
import { getHighlighterOptions } from '../utils/getHighlighterOptions';
import { getHighlighterThemeStyles } from '../utils/getHighlighterThemeStyles';
import { getOrCreateCodeNode } from '../utils/getOrCreateCodeNode';
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

export class FileStream {
  readonly __id: string = `file-stream:${++instanceId}`;

  private highlighter: DiffsHighlighter | undefined;
  private stream: ReadableStream<string> | undefined;
  private abortController: AbortController | undefined;
  private fileContainer: HTMLElement | undefined;
  pre: HTMLPreElement | undefined;
  private code: HTMLElement | undefined;

  constructor(public options: FileStreamOptions = { theme: DEFAULT_THEMES }) {
    this.currentLineIndex = this.options.startingLineIndex ?? 1;
  }

  cleanUp(): void {
    this.abortController?.abort();
    this.abortController = undefined;
  }

  setThemeType(themeType: ThemeTypes): void {
    if ((this.options.themeType ?? 'system') === themeType) {
      return;
    }
    this.options = { ...this.options, themeType };

    // Update pre element theme mode
    if (this.pre != null) {
      switch (themeType) {
        case 'system':
          delete this.pre.dataset.themeType;
          break;
        case 'light':
        case 'dark':
          this.pre.dataset.themeType = themeType;
          break;
      }
    }
  }

  private async initializeHighlighter(): Promise<DiffsHighlighter> {
    this.highlighter = await getSharedHighlighter(
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
    if (this.pre.parentElement == null) {
      fileContainer.shadowRoot?.appendChild(this.pre);
    }
    const themeStyles = getHighlighterThemeStyles({ theme, highlighter });
    const baseThemeType =
      typeof theme === 'string' ? highlighter.getTheme(theme).type : undefined;
    const pre = setPreNodeProperties(this.pre, {
      diffIndicators: 'none',
      disableBackground: true,
      disableLineNumbers,
      overflow,
      split: false,
      themeType: baseThemeType ?? themeType,
      themeStyles,
      totalLines: 0,
    });
    pre.innerHTML = '';

    this.pre = pre;
    this.code = getOrCreateCodeNode({ code: this.code, pre });
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { onStreamStart, onStreamClose, onStreamAbort } = this.options;
    this.stream = stream;
    this.stream
      .pipeThrough(
        typeof theme === 'string'
          ? new CodeToTokenTransformStream({
              ...this.options,
              theme,
              highlighter,
              allowRecalls: true,
              defaultColor: false,
              cssVariablePrefix: formatCSSVariablePrefix('token'),
            })
          : new CodeToTokenTransformStream({
              ...this.options,
              themes: theme,
              highlighter,
              allowRecalls: true,
              defaultColor: false,
              cssVariablePrefix: formatCSSVariablePrefix('token'),
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
      .catch((error) => {
        // Ignore AbortError - it's expected when cleaning up
        if (error.name !== 'AbortError') {
          console.error('FileStream pipe error:', error);
        }
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
    const linesToAppend: HTMLElement[] = [];
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

  private createLine(): HTMLElement {
    const { row, content } = createRowNodes(this.currentLineIndex);
    this.currentLineElement = content;
    return row;
  }

  private getOrCreateFileContainer(fileContainer?: HTMLElement): HTMLElement {
    if (
      (fileContainer != null && fileContainer === this.fileContainer) ||
      (fileContainer == null && this.fileContainer != null)
    ) {
      return this.fileContainer;
    }
    this.fileContainer =
      fileContainer ?? document.createElement(DIFFS_TAG_NAME);
    return this.fileContainer;
  }
}
