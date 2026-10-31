import type { HighlighterCore } from 'shiki/core';
import {
  EncodedTokenMetadata,
  type IGrammar,
  INITIAL,
  type StateStack,
} from 'shiki/textmate';

import type { TextDocumentChange } from '../editor/textDocument';
import { debounce } from '../editor/utils';
import type { HighlightedToken } from '../types';
import {
  type LineChange,
  lineChangesOf,
  moveLineEntries,
} from '../utils/lineChanges';
import type { LineWindow } from './DiffsEditorTokenizer';
import type { DiffsEditorTokenizerOptions } from './tokenizer-types';
import type { DiffsHighlighter } from './types';

// Timed aborts can leave incomplete grammar state; limit line length instead.
const TOKENIZE_TIME_LIMIT = 0;
// How long one background slice may run before yielding.
const SLICE_BUDGET_MS = 1;
let nextTokenizerId = 0;

// What is known about one line. `state` is the state the line starts from,
// as it was last colored or lexed; the record past the last line holds the
// state the document ends in. `brackets` are the string, comment and regexp
// ranges that run found: null when it found none or skipped the line, and
// undefined until the line has been colored or lexed.
interface LineRecord {
  state: StateStack;
  brackets: [number, number][] | null | undefined;
}

/**
 * Colors an editable document with a TextMate grammar, a line at a time.
 *
 * Every line has a record with the grammar state at its start, moved with
 * the line when lines are added or removed above it. The state in a record
 * is the state the line was last colored from. Edits mark lines dirty;
 * `advance` colors dirty lines in order, delivers them, and stops once a
 * line's end state matches the state the next line was colored from, since
 * everything below is then unaffected. Lines that have never been colored
 * show the highlight result, which is right for their text, so reaching one
 * of them only needs its state.
 */
export class ShikiEditorTokenizer {
  #highlighter: HighlighterCore;
  #grammar: IGrammar | undefined;
  #themeName: string;
  #colorMap: string[];
  #textDocument: DiffsEditorTokenizerOptions['textDocument'];
  #tokenizeMaxLineLength: number;
  #onDeferTokenize: DiffsEditorTokenizerOptions['onDeferTokenize'];
  #matchBrackets: boolean;
  #debug: boolean;
  #disposed = false;
  // One record per line, and one more for the state the document ends in.
  // A line nothing is known about yet has no record.
  #lines: (LineRecord | undefined)[] = [
    { state: INITIAL, brackets: undefined },
  ];
  // Lines whose colors are behind the text, sorted and not overlapping.
  #dirty: [number, number][] = [];
  // The line the attach window ends at, whose states are built in the
  // background so the first edit there starts from a known state.
  #coldTarget = -1;
  #paused = false;
  #generation = 0;
  #tokenizerId = ++nextTokenizerId;
  #listening = false;

  #primeLater = debounce(async (end: number) => {
    if (this.#disposed) {
      return;
    }
    if (
      this.#grammar == null &&
      !isGrammarlessLanguage(this.#textDocument.languageId)
    ) {
      await this.backend?.loadLanguages([this.#textDocument.languageId]);
      if (this.#disposed) {
        return;
      }
      this.#grammar = this.#highlighter.getLanguage(
        this.#textDocument.languageId
      );
    }
    this.#ensureActiveTheme();
    this.#coldTarget = Math.max(this.#coldTarget, end);
    this.#schedule();
  }, 500);

  #onMessage = ({ data }: MessageEvent<unknown>) => {
    if (typeof data !== 'object' || data === null) {
      return;
    }
    const { type, tokenizerId, jobId } = data as {
      type?: unknown;
      tokenizerId?: unknown;
      jobId?: unknown;
    };
    if (
      type === 'tokenize' &&
      tokenizerId === this.#tokenizerId &&
      jobId === this.#generation
    ) {
      this.#slice();
    }
  };

  constructor(
    highlighter: HighlighterCore,
    options: DiffsEditorTokenizerOptions,
    private readonly backend?: Pick<
      DiffsHighlighter,
      'getTheme' | 'loadLanguages'
    >
  ) {
    this.#highlighter = highlighter;
    this.#textDocument = options.textDocument;
    this.#themeName = options.theme;
    this.#colorMap = [];
    // The cutoff must match codeToTokens and Highlights: length >= limit.
    this.#tokenizeMaxLineLength = options.tokenizeMaxLineLength ?? 1000;
    this.#onDeferTokenize = options.onDeferTokenize;
    this.#matchBrackets = options.matchBrackets !== false;
    this.#debug = options.__debug ?? false;
    this.#ensureGrammar();
    this.#ensureActiveTheme();
  }

  /**
   * Takes an edit: marks its lines dirty, moves the states and dirty lines
   * below it, and colors from the first dirty line for up to a millisecond.
   * Returns every line colored, in and above `window`. The rest continues
   * in the background.
   */
  applyChange(
    change: TextDocumentChange,
    window?: LineWindow
  ): Map<number, HighlightedToken[]> {
    this.#ensureGrammar();
    this.#ensureActiveTheme();
    if (
      this.#grammar == null &&
      !isGrammarlessLanguage(this.#textDocument.languageId)
    ) {
      throw new Error(
        `Grammar for language "${this.#textDocument.languageId}" not loaded`
      );
    }
    const lineChanges = lineChangesOf(change);
    // A line that stays keeps its record; a line the edit added has none yet.
    this.#lines = moveLineEntries(
      this.#lines,
      lineChanges,
      () => undefined
    ).entries;
    this.#moveDirtyLines(lineChanges);
    this.#addDirty(
      change.changedLineRanges ?? [[change.startLine, change.endLine]]
    );
    this.#paused = false;
    const until = window == null ? this.#textDocument.lineCount : window[1];
    const lines = this.advance(
      until,
      window == null ? undefined : SLICE_BUDGET_MS
    );
    this.#schedule();
    return lines;
  }

  /**
   * Colors every dirty line before `end` now and returns them. A pause stays
   * in force: the rest waits for `resume`.
   */
  flush(end: number): Map<number, HighlightedToken[]> {
    this.#ensureGrammar();
    this.#ensureActiveTheme();
    const lines = this.advance(end);
    this.#schedule();
    return lines;
  }

  /**
   * Builds the states of the lines up to the attach window's end in the
   * background, so the first edit there starts from a known state. The rows
   * keep what they show until an edit colors them.
   */
  prime(window: LineWindow): void {
    this.#ensureGrammar();
    this.#primeLater(window[1]);
  }

  /**
   * The string, comment and regexp ranges of a line, from its last coloring,
   * or lexed now for a line never colored. Null without a grammar.
   */
  bracketIgnoredRanges(line: number): [number, number][] | null {
    this.#ensureGrammar();
    if (this.#grammar == null) {
      return null;
    }
    if (this.#lines[line]?.brackets === undefined) {
      const state = this.#lexState(line, this.#stateAt(line));
      if (this.#lines[line + 1] == null) {
        this.#setState(line + 1, state);
      }
    }
    return this.#lines[line]?.brackets ?? null;
  }

  setTheme(themeName: string): void {
    if (this.#themeName === themeName) return;
    this.#themeName = themeName;
    this.#ensureActiveTheme();
    // Colors come from the theme, so every line is colored again.
    this.#addDirty([[0, this.#textDocument.lineCount - 1]]);
    this.#schedule();
  }

  pause(): void {
    if (this.#paused) return;
    if (this.#debug) {
      console.log('[diffs/editor] background tokenization paused');
    }
    this.#paused = true;
    this.#generation++;
  }

  resume(): void {
    if (!this.#paused) return;
    if (this.#debug) {
      console.log('[diffs/editor] background tokenization resumed');
    }
    this.#paused = false;
    this.#schedule();
  }

  dispose(): void {
    this.#disposed = true;
    this.#generation++;
    this.#dirty = [];
    this.#coldTarget = -1;
    this.#stopListening();
  }

  /**
   * Colors dirty lines in order until they settle, `until` is reached, or
   * the budget runs out, and returns what it colored. A dirty range settles
   * once a line past its end ends in the state the next line was colored
   * from; a range whose start state is unknown first builds the states of
   * the lines leading to it.
   */
  advance(until: number, budgetMs?: number): Map<number, HighlightedToken[]> {
    const lines = new Map<number, HighlightedToken[]>();
    if (
      this.#grammar == null &&
      !isGrammarlessLanguage(this.#textDocument.languageId)
    ) {
      return lines;
    }
    const startedAt = budgetMs == null ? 0 : performance.now();
    const end = Math.min(until, this.#textDocument.lineCount);
    while (this.#dirty.length > 0) {
      const range = this.#dirty[0];
      let line = range[0];
      if (line >= end) {
        break;
      }
      let state = this.#stateAt(line);
      let settled = false;
      while (line < end) {
        const previous = this.#lines[line + 1]?.state;
        const result = this.#tokenizeLineAt(line, state);
        lines.set(line, result.resolvedTokens);
        state = result.state;
        this.#setState(line + 1, state);
        line++;
        if (line > range[1] && previous != null && state.equals(previous)) {
          settled = true;
          break;
        }
        if (budgetMs != null && performance.now() - startedAt > budgetMs) {
          break;
        }
      }
      if (settled || line >= this.#textDocument.lineCount) {
        this.#dirty.shift();
        // Ranges the coloring ran through on its way are done too.
        while (this.#dirty.length > 0 && this.#dirty[0][1] < line) {
          this.#dirty.shift();
        }
        if (this.#dirty.length > 0 && this.#dirty[0][0] < line) {
          this.#dirty[0][0] = line;
        }
        continue;
      }
      // The range picks up from here next time; its end never precedes
      // its start.
      range[0] = line;
      if (range[1] < line) {
        range[1] = line;
      }
      break;
    }
    return lines;
  }

  // Runs one background slice: dirty lines first, then the states leading
  // to the attach window.
  #slice(): void {
    if (this.#paused || this.#disposed) {
      return;
    }
    this.#ensureActiveTheme();
    const startedAt = performance.now();
    const lines = this.advance(this.#textDocument.lineCount, SLICE_BUDGET_MS);
    if (lines.size > 0) {
      this.#onDeferTokenize(lines);
    }
    if (this.#dirty.length === 0 && this.#coldTarget >= 0) {
      const target = Math.min(this.#coldTarget, this.#textDocument.lineCount);
      let line = this.#knownThrough();
      let state = this.#lines[line]?.state ?? INITIAL;
      while (line < target) {
        state = this.#lexState(line, state);
        line++;
        this.#setState(line, state);
        if (performance.now() - startedAt > SLICE_BUDGET_MS) {
          break;
        }
      }
      if (line >= target) {
        this.#coldTarget = -1;
      }
    }
    this.#schedule();
  }

  #schedule(): void {
    if (
      this.#paused ||
      this.#disposed ||
      (this.#dirty.length === 0 && this.#coldTarget < 0) ||
      isGrammarlessLanguage(this.#textDocument.languageId)
    ) {
      this.#stopListening();
      return;
    }
    const jobId = ++this.#generation;
    if (!this.#listening) {
      globalThis.addEventListener('message', this.#onMessage);
      this.#listening = true;
    }
    // A message instead of a timer: it has no minimum delay.
    globalThis.postMessage({
      type: 'tokenize',
      tokenizerId: this.#tokenizerId,
      jobId,
    });
  }

  #stopListening(): void {
    if (!this.#listening) {
      return;
    }
    globalThis.removeEventListener('message', this.#onMessage);
    this.#listening = false;
  }

  // Adds sorted, non-overlapping `ranges` to the dirty set in one pass over
  // both lists, joining ranges that touch.
  #addDirty(ranges: readonly (readonly [number, number])[]): void {
    const merged: [number, number][] = [];
    let mine = 0;
    let theirs = 0;
    while (mine < this.#dirty.length || theirs < ranges.length) {
      const own = this.#dirty[mine];
      const added = ranges[theirs];
      let next: readonly [number, number];
      if (added == null || (own != null && own[0] <= added[0])) {
        next = own;
        mine++;
      } else {
        next = added;
        theirs++;
      }
      if (next[1] < next[0]) {
        continue;
      }
      const last = merged[merged.length - 1];
      if (last != null && next[0] <= last[1] + 1) {
        last[1] = Math.max(last[1], next[1]);
      } else {
        merged.push([next[0], next[1]]);
      }
    }
    this.#dirty = merged;
  }

  // Moves the dirty lines through an edit's line changes, one change at a
  // time in the order they were applied. A range a change cuts through grows
  // to cover the change.
  #moveDirtyLines(lineChanges: readonly LineChange[]): void {
    for (const [start, end, lineDelta] of lineChanges) {
      const oldEnd = end - lineDelta;
      for (const range of this.#dirty) {
        if (range[1] < start) {
          continue;
        }
        if (range[0] > oldEnd) {
          range[0] += lineDelta;
          range[1] += lineDelta;
        } else {
          range[0] = Math.min(range[0], start);
          range[1] = Math.max(range[1] + lineDelta, end);
        }
      }
    }
  }

  // The last line whose start state is known.
  #knownThrough(): number {
    let line = Math.min(this.#lines.length - 1, this.#textDocument.lineCount);
    while (line > 0 && this.#lines[line] == null) {
      line--;
    }
    return line;
  }

  // The state `line` starts from, building the states of the lines leading
  // to it when they are not known yet. Those lines have never been colored,
  // so the rows show the highlight result for them, which these states fit.
  #stateAt(line: number): StateStack {
    const known = this.#lines[line]?.state;
    if (known != null) {
      return known;
    }
    let at = this.#knownThrough();
    if (at > line) {
      at = line;
      while (at > 0 && this.#lines[at] == null) {
        at--;
      }
    }
    let state = this.#lines[at]?.state ?? INITIAL;
    for (; at < line; at++) {
      state = this.#lexState(at, state);
      this.#setState(at + 1, state);
    }
    return state;
  }

  // Records the state `line` starts from, keeping what its last lexing found.
  #setState(line: number, state: StateStack): void {
    const record = this.#lines[line];
    if (record == null) {
      this.#lines[line] = { state, brackets: undefined };
    } else {
      record.state = state;
    }
  }

  #ensureActiveTheme(): void {
    if (this.#themeName === '') {
      return;
    }
    // Resolving a theme does not attach it to Shiki until the backend uses it.
    this.backend?.getTheme(this.#themeName);
    const { colorMap } = this.#highlighter.setTheme(this.#themeName);
    this.#colorMap = colorMap;
  }

  #ensureGrammar(): void {
    if (
      this.#grammar == null &&
      !isGrammarlessLanguage(this.#textDocument.languageId) &&
      this.#highlighter
        .getLoadedLanguages()
        .includes(this.#textDocument.languageId)
    ) {
      this.#grammar = this.#highlighter.getLanguage(
        this.#textDocument.languageId
      );
    }
  }

  #tokenizeLineAt(
    line: number,
    state: StateStack
  ): { resolvedTokens: HighlightedToken[]; state: StateStack } {
    const lineText = this.#textDocument.getLineText(line);
    if (lineText.length >= this.#tokenizeMaxLineLength) {
      console.warn(
        `[diffs] Line(${line}) too long to tokenize: ${lineText.length}`
      );
      this.#cacheBracketRanges(line, null);
      return { resolvedTokens: [[0, '', lineText]], state };
    }
    if (this.#grammar == null || lineText === '' || lineText.trim() === '') {
      this.#cacheBracketRanges(line, null);
      return { resolvedTokens: [[0, '', lineText]], state };
    }
    const result = tokenizeLine(
      this.#grammar,
      this.#colorMap,
      lineText,
      state,
      TOKENIZE_TIME_LIMIT,
      this.#matchBrackets
    );
    this.#cacheBracketRanges(line, result.bracketIgnoredRanges);
    return {
      resolvedTokens: result.resolvedTokens,
      state: result.ruleStack,
    };
  }

  // Lexes a line for its end state alone.
  #lexState(line: number, state: StateStack): StateStack {
    const lineText = this.#textDocument.getLineText(line);
    if (
      this.#grammar == null ||
      lineText.length >= this.#tokenizeMaxLineLength ||
      lineText === '' ||
      lineText.trim() === ''
    ) {
      this.#cacheBracketRanges(line, null);
      return state;
    }
    const result = tokenizeLine(
      this.#grammar,
      this.#colorMap,
      lineText,
      state,
      TOKENIZE_TIME_LIMIT,
      this.#matchBrackets,
      false
    );
    this.#cacheBracketRanges(line, result.bracketIgnoredRanges);
    return result.ruleStack;
  }

  // Stores the ranges a coloring or lexing of `line` found. The line has a
  // record, since the state it was colored from was known.
  #cacheBracketRanges(line: number, ranges: [number, number][] | null): void {
    if (!this.#matchBrackets) {
      return;
    }
    const record = this.#lines[line];
    if (record == null) {
      throw new Error(`ShikiEditorTokenizer: line ${line} has no record`);
    }
    record.brackets = ranges;
  }
}

function tokenizeLine(
  grammar: IGrammar,
  colorMap: string[],
  lineText: string,
  stateStack: StateStack,
  timeLimit?: number,
  collectBracketIgnoredRanges = true,
  resolveTokens = true
): {
  ruleStack: StateStack;
  resolvedTokens: HighlightedToken[];
  bracketIgnoredRanges: [number, number][];
} {
  const result = grammar.tokenizeLine2(lineText, stateStack, timeLimit);
  if (result.stoppedEarly) {
    console.warn(
      `[diffs] Time limit reached when tokenizing line: ${lineText.substring(0, 100)}`
    );
  }
  const rawTokens = result.tokens;
  const tokensLength = rawTokens.length / 2;
  const resolvedTokens: HighlightedToken[] = [];
  const bracketIgnoredRanges: [number, number][] = [];
  if (!resolveTokens && !collectBracketIgnoredRanges) {
    return {
      ruleStack: result.ruleStack,
      resolvedTokens,
      bracketIgnoredRanges,
    };
  }
  for (let j = 0; j < tokensLength; j++) {
    const offset = rawTokens[2 * j];
    const nextOffset =
      j + 1 < tokensLength ? rawTokens[2 * j + 2] : lineText.length;
    if (offset === nextOffset) {
      continue;
    }
    const metadata = rawTokens[2 * j + 1];
    if (resolveTokens) {
      const fg = EncodedTokenMetadata.getForeground(metadata);
      resolvedTokens.push([
        offset,
        colorMap[fg],
        lineText.slice(offset, nextOffset),
      ]);
    }
    if (
      collectBracketIgnoredRanges &&
      EncodedTokenMetadata.getTokenType(metadata) > 0
    ) {
      bracketIgnoredRanges.push([offset, nextOffset]);
    }
  }
  return {
    ruleStack: result.ruleStack,
    resolvedTokens,
    bracketIgnoredRanges,
  };
}

// Shiki special-cases `text` and `ansi` in codeToHast but does not expose grammars.
function isGrammarlessLanguage(languageId: string): boolean {
  return languageId === 'text' || languageId === 'ansi';
}
