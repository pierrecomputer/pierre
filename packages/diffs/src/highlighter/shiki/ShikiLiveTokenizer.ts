import {
  applyColorReplacements,
  type GrammarState,
  type HighlighterCore,
  isNoneTheme,
  isSpecialLang,
  type CodeToTokensOptions as ShikiTokenOptions,
} from 'shiki/core';
import { EncodedTokenMetadata, INITIAL, type StateStack } from 'shiki/textmate';

import type {
  TextDocument,
  TextDocumentChange,
} from '../../editor/textDocument';
import type {
  DiffsLiveTokenizer,
  DiffsLiveTokenizerOptions,
  HighlightedToken,
  ThemedToken,
} from '../../types';
import { getShikiAnsiTokens } from './getShikiAnsiTokens';
import { getShikiOptions } from './getShikiOptions';

interface Line {
  state?: GrammarState | StateStack | string;
  cached?: boolean;
  tokens?: ThemedToken[];
  bracketIgnoredRanges?: [number, number][];
}

let nextLiveTokenizerId = 0;

/** Retain each line's outgoing grammar state so edits stop at convergence. */
export class ShikiLiveTokenizer implements DiffsLiveTokenizer {
  #highlighter: HighlighterCore;
  #options: ShikiTokenOptions;
  #firstThemeOptions?: ShikiTokenOptions;
  #onDeferTokenize: DiffsLiveTokenizerOptions['onDeferTokenize'];
  #textDocument: TextDocument;
  #documentRevision = -1;
  #lines: (Line | undefined)[] = [];
  #pending: number[] = [];
  #tokenizerId = ++nextLiveTokenizerId;
  #jobId = 0;
  #scheduled = false;
  #listening = false;
  #channel?: MessageChannel;
  #timer?: ReturnType<typeof setTimeout>;
  #paused = false;
  #disposed = false;
  #updating = false;

  #onMessage = ({ data, source }: MessageEvent<unknown>): void => {
    if (
      (this.#listening && source !== window) ||
      typeof data !== 'object' ||
      data === null
    )
      return;
    const { type, tokenizerId, jobId } = data as {
      type?: unknown;
      tokenizerId?: unknown;
      jobId?: unknown;
    };
    if (
      type === 'diffs:shiki-tokenize' &&
      tokenizerId === this.#tokenizerId &&
      typeof jobId === 'number'
    )
      this.#backgroundTokenize(jobId);
  };

  constructor(
    highlighter: HighlighterCore,
    options: DiffsLiveTokenizerOptions
  ) {
    const { textDocument, renderRange, onDeferTokenize, ...tokenOptions } =
      options;
    this.#textDocument = textDocument;
    this.#highlighter = highlighter;
    this.#options = getShikiOptions(tokenOptions, highlighter);
    if ('dark' in options.theme && 'light' in options.theme) {
      // Shiki's merged theme tokens omit token types used for bracket matching.
      this.#firstThemeOptions = getShikiOptions(
        {
          ...tokenOptions,
          theme:
            options.defaultColor === false || options.defaultColor === 'dark'
              ? options.theme.dark
              : options.theme.light,
        },
        highlighter
      );
    }
    this.#onDeferTokenize = onDeferTokenize;
    this.reset({ renderRange });
  }

  get pendingTokenization(): boolean {
    this.#check();
    return (
      this.#pending.length > 0 ||
      this.#documentRevision !== this.#textDocument.revision
    );
  }

  getLineTokens(line: number): ReturnType<DiffsLiveTokenizer['getLineTokens']> {
    this.#check();
    if (
      !Number.isInteger(line) ||
      line < 0 ||
      line >= this.#textDocument.lineCount
    ) {
      throw new RangeError(`line ${line} out of range`);
    }
    const entry =
      this.#documentRevision === this.#textDocument.revision
        ? this.#lines[line]
        : undefined;
    return {
      tokens:
        entry?.tokens ??
        this.#highlighter.codeToTokens(this.#textDocument.getLineText(line), {
          ...this.#options,
          lang: 'text',
        }).tokens[0],
      bracketIgnoredRanges: entry?.bracketIgnoredRanges ?? [],
    };
  }

  /** Remap cached states after the editor has changed the shared document. */
  tokenize(
    change: TextDocumentChange,
    options?: Pick<DiffsLiveTokenizerOptions, 'renderRange'>
  ): ReturnType<DiffsLiveTokenizer['tokenize']> {
    this.#check(options);
    if (this.#updating)
      throw new Error('Cannot tokenize during a tokenizer update');
    if (this.#documentRevision === this.#textDocument.revision) {
      this.#paused = false;
      return { lines: this.#update(options?.renderRange) };
    }
    const changes = change.changedLineChanges ?? [
      [change.startLine, change.endLine, change.lineDelta],
    ];
    // Joining CR and LF across an edit boundary can change the line count
    // beyond the per-edit metadata. Rebuild when those coordinates cannot align.
    if (
      this.#textDocument.revision !== this.#documentRevision + 1 ||
      change.previousLineCount !== this.#lines.length ||
      change.lineCount !== this.#textDocument.lineCount ||
      changes.reduce((delta, [, , lineDelta]) => delta + lineDelta, 0) !==
        change.lineDelta
    ) {
      return this.reset(options);
    }
    // Raw offset edits can split one CRLF and join another in the same batch,
    // leaving the total line delta unchanged while shifting individual ranges.
    if (change.changedLineChanges !== undefined) {
      let offsetDelta = 0;
      for (let i = 0; i < change.changes.length; i++) {
        const edit = change.changes[i];
        const start = edit.start + offsetDelta;
        const range = change.changedLineChanges[i];
        if (
          range === undefined ||
          this.#textDocument.positionAt(start).line !== range[0] ||
          this.#textDocument.positionAt(start + edit.text.length).line !==
            range[1]
        ) {
          return this.reset(options);
        }
        offsetDelta += edit.text.length - (edit.end - edit.start);
      }
    }
    this.#cancel();
    this.#paused = false;
    // These ranges include earlier edits' line deltas, so apply them in order.
    for (const [start, end, delta] of changes) {
      const oldEnd = end - delta;
      const previous = this.#lines[oldEnd];
      const replacement = new Array<Line | undefined>(end - start + 1);
      replacement[replacement.length - 1] = {
        state: previous?.state,
        cached: previous?.cached,
      };
      if (replacement.length < 8192) {
        this.#lines.splice(start, oldEnd - start + 1, ...replacement);
      } else {
        this.#lines = this.#lines
          .slice(0, start)
          .concat(replacement, this.#lines.slice(oldEnd + 1));
      }
      this.#pending = [
        ...new Set([
          ...this.#pending.map((line) =>
            line < start ? line : line <= oldEnd ? start : line + delta
          ),
          start,
        ]),
      ].sort((a, b) => a - b);
    }
    if (this.#lines.length !== this.#textDocument.lineCount)
      return this.reset(options);
    this.#documentRevision = this.#textDocument.revision;
    return { lines: this.#update(options?.renderRange) };
  }

  reset(
    options?: Pick<DiffsLiveTokenizerOptions, 'renderRange'>
  ): ReturnType<DiffsLiveTokenizer['reset']> {
    this.#check(options);
    if (this.#updating)
      throw new Error('Cannot reset during a tokenizer update');
    this.#cancel();
    this.#paused = false;
    this.#documentRevision = this.#textDocument.revision;
    this.#lines = new Array(this.#textDocument.lineCount);
    this.#pending = [0];
    return { lines: this.#update(options?.renderRange) };
  }

  flush(endLine: number = this.#textDocument.lineCount): void {
    this.#check({ renderRange: [0, endLine] });
    if (this.#documentRevision !== this.#textDocument.revision)
      this.reset({ renderRange: [0, 0] });
    this.#cancel();
    this.#paused = false;
    const lines = this.#run(
      endLine,
      Infinity,
      this.#onDeferTokenize !== undefined
    );
    if (lines.size > 0) this.#onDeferTokenize?.(lines);
    this.#schedule();
  }

  pause(): void {
    this.#check();
    this.#paused = true;
    this.#cancel();
  }

  resume(): void {
    this.#check();
    this.#paused = false;
    this.#schedule();
  }

  dispose(): void {
    this.#cancel();
    this.#disposed = true;
    this.#lines = [];
    this.#pending = [];
    this.#onDeferTokenize = undefined;
  }

  #check(options?: Pick<DiffsLiveTokenizerOptions, 'renderRange'>): void {
    if (this.#disposed) throw new Error('Tokenizer is disposed');
    const range = options?.renderRange;
    if (
      range !== undefined &&
      (!Number.isInteger(range[0]) ||
        !Number.isInteger(range[1]) ||
        range[0] < 0 ||
        range[1] < range[0])
    ) {
      throw new RangeError('renderRange must have 0 <= startLine <= endLine');
    }
  }

  #cancel(): void {
    this.#jobId++;
    this.#scheduled = false;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#listening) {
      globalThis.removeEventListener('message', this.#onMessage);
      this.#listening = false;
    }
    this.#channel?.port1.close();
    this.#channel?.port2.close();
    this.#channel = undefined;
  }

  /** Finish visible lines and send completed lines above them to the host. */
  #update(range?: readonly [number, number]): Map<number, HighlightedToken[]> {
    this.#updating = true;
    try {
      const finished = this.#run(
        range === undefined
          ? Infinity
          : range[0] >= this.#lines.length
            ? 0
            : range[1],
        Infinity,
        range !== undefined
      );
      const lines = new Map<number, HighlightedToken[]>();
      if (range !== undefined) {
        for (const [line, tokens] of finished) {
          if (line >= range[0] && line < range[1]) {
            lines.set(line, tokens);
            finished.delete(line);
          }
        }
        if (finished.size > 0) this.#onDeferTokenize?.(finished);
      }
      this.#schedule();
      return lines;
    } finally {
      this.#updating = false;
    }
  }

  /** Process dirty spans until their outgoing stacks match the retained cache. */
  #run(
    end: number,
    deadline = Infinity,
    collect = true
  ): Map<number, HighlightedToken[]> {
    const finished = new Map<number, HighlightedToken[]>();
    if (
      this.#documentRevision !== this.#textDocument.revision ||
      this.#pending.length === 0 ||
      this.#pending[0] >= end
    )
      return finished;
    // Resolve the editor's single theme once per slice and retain TextMate's
    // stacks directly, avoiding per-line GrammarState and theme setup.
    const singleTheme =
      'theme' in this.#options &&
      !isNoneTheme(this.#options.theme) &&
      !isSpecialLang(this.#options.lang)
        ? this.#highlighter.setTheme(this.#options.theme)
        : undefined;
    const grammar =
      singleTheme === undefined
        ? undefined
        : this.#highlighter.getLanguage(this.#options.lang ?? 'text');
    while (this.#pending.length > 0 && this.#pending[0] < end) {
      const index = this.#pending[0];
      const line = (this.#lines[index] ??= {});
      const text = this.#textDocument.getLineText(index);
      const incoming = this.#lines[index - 1]?.state;
      const grammarState =
        incoming !== undefined &&
        typeof incoming !== 'string' &&
        'themes' in incoming
          ? incoming
          : undefined;
      const ansiState = typeof incoming === 'string' ? incoming : '';
      let tokens: ThemedToken[][];
      let state: Line['state'];
      if (singleTheme !== undefined && grammar !== undefined) {
        state =
          incoming !== undefined &&
          typeof incoming !== 'string' &&
          'equals' in incoming
            ? incoming
            : INITIAL;
        const lineTokens: ThemedToken[] = [];
        tokens = [lineTokens];
        const max = this.#options.tokenizeMaxLineLength ?? 0;
        if (text.length > 0 && max > 0 && text.length >= max) {
          lineTokens.push({
            content: text,
            offset: 0,
            color: '',
            fontStyle: 0,
          });
        } else if (text.length > 0) {
          const result = grammar.tokenizeLine2(
            text,
            state,
            this.#options.tokenizeTimeLimit
          );
          state = result.ruleStack;
          const raw = result.tokens;
          for (let i = 0; i < raw.length; i += 2) {
            const start = raw[i];
            const end = i + 2 < raw.length ? raw[i + 2] : text.length;
            if (start === end) continue;
            const metadata = raw[i + 1];
            lineTokens.push({
              content: text.slice(start, end),
              offset: start,
              color: applyColorReplacements(
                singleTheme.colorMap[
                  EncodedTokenMetadata.getForeground(metadata)
                ],
                singleTheme.theme.colorReplacements
              ),
              fontStyle: EncodedTokenMetadata.getFontStyle(metadata),
              type: EncodedTokenMetadata.getTokenType(metadata),
            });
          }
        }
      } else if (this.#options.lang === 'ansi') {
        const result = getShikiAnsiTokens(
          this.#highlighter,
          text,
          this.#options,
          ansiState
        );
        tokens = result.tokens;
        state = result.state;
      } else {
        const result = this.#highlighter.codeToTokens(text, {
          ...this.#options,
          grammarState,
        });
        tokens = result.tokens;
        state = result.grammarState;
      }
      const typedTokens =
        this.#firstThemeOptions === undefined
          ? tokens[0]
          : this.#options.lang === 'ansi'
            ? getShikiAnsiTokens(
                this.#highlighter,
                text,
                this.#firstThemeOptions,
                ansiState
              ).tokens[0]
            : this.#highlighter.codeToTokens(text, {
                ...this.#firstThemeOptions,
                grammarState,
              }).tokens[0];
      const previous = line.state;
      const converged =
        line.cached === true &&
        (state === previous ||
          (state !== undefined &&
            previous !== undefined &&
            typeof state !== 'string' &&
            typeof previous !== 'string' &&
            'equals' in state &&
            'equals' in previous &&
            state.equals(previous)) ||
          (state !== undefined &&
            previous !== undefined &&
            typeof state !== 'string' &&
            typeof previous !== 'string' &&
            'themes' in state &&
            'themes' in previous &&
            state.lang === previous.lang &&
            state.themes.length === previous.themes.length &&
            state.themes.every((theme) => {
              const stack = state.getInternalStack(theme);
              const oldStack = previous.getInternalStack(theme);
              return (
                stack === oldStack ||
                (stack !== undefined &&
                  oldStack !== undefined &&
                  stack.equals(oldStack))
              );
            })));
      line.tokens = tokens[0];
      line.state = state;
      line.cached = true;
      const ignored: [number, number][] = [];
      for (const token of typedTokens) {
        if (
          token.type === undefined ||
          token.type < 1 ||
          token.type > 3 ||
          token.content.length === 0
        )
          continue;
        const previousRange = ignored[ignored.length - 1];
        const end = token.offset + token.content.length;
        if (previousRange !== undefined && previousRange[1] >= token.offset)
          previousRange[1] = end;
        else ignored.push([token.offset, end]);
      }
      line.bracketIgnoredRanges = ignored;
      if (collect)
        finished.set(
          index,
          typedTokens.length > 0
            ? typedTokens.map((token) => [
                token.offset,
                token.color ?? '',
                token.content,
              ])
            : [[0, '', '']]
        );
      if (converged || index + 1 === this.#lines.length) this.#pending.shift();
      else this.#pending[0] = index + 1;
      while (this.#pending.length > 1 && this.#pending[0] >= this.#pending[1])
        this.#pending.shift();
      if (deadline !== Infinity && performance.now() >= deadline) break;
    }
    return finished;
  }

  /** Ignore canceled messages before running the next bounded slice. */
  #backgroundTokenize(jobId: number): void {
    if (jobId !== this.#jobId || !this.#scheduled) return;
    this.#scheduled = false;
    const lines = this.#run(
      Infinity,
      performance.now() + 4,
      this.#onDeferTokenize !== undefined
    );
    if (lines.size > 0) this.#onDeferTokenize?.(lines);
    this.#schedule();
  }

  /** Use posted messages to yield without nested timers' 4ms minimum delay. */
  #schedule(): void {
    if (
      this.#disposed ||
      this.#documentRevision !== this.#textDocument.revision ||
      this.#paused ||
      this.#pending.length === 0
    ) {
      this.#cancel();
      return;
    }
    if (this.#scheduled) return;
    this.#scheduled = true;
    const jobId = ++this.#jobId;
    const message = {
      type: 'diffs:shiki-tokenize',
      tokenizerId: this.#tokenizerId,
      jobId,
    };
    if (
      typeof window !== 'undefined' &&
      window === globalThis &&
      typeof globalThis.postMessage === 'function'
    ) {
      if (!this.#listening) {
        globalThis.addEventListener('message', this.#onMessage);
        this.#listening = true;
      }
      globalThis.postMessage(message);
    } else if (typeof MessageChannel !== 'undefined') {
      // Workers and server runtimes need a local channel, not an outward post.
      if (this.#channel === undefined) {
        this.#channel = new MessageChannel();
        this.#channel.port1.onmessage = this.#onMessage;
      }
      this.#channel.port2.postMessage(message);
    } else {
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        this.#backgroundTokenize(jobId);
      }, 0);
    }
  }
}
