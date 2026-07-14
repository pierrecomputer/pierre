import { describe, expect, test } from 'bun:test';

import {
  type MatchRange,
  SearchPanelWidget,
  type SearchParams,
} from '../../src/editor/searchPanel';
import {
  DirectionForward,
  DirectionNone,
  expandCollapsedSelectionToWord,
  findNexMatch,
} from '../../src/editor/selection';
import { TextDocument } from '../../src/editor/textDocument';
import type { EditorSelection } from '../../src/types';
import { installDom, wait } from '../domHarness';

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function caret(line: number, character: number): EditorSelection {
  const position = { line, character };
  return { start: position, end: position, direction: DirectionNone };
}

function sel(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): EditorSelection {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    direction: DirectionForward,
  };
}

function params(
  text: string,
  overrides: Partial<SearchParams> = {}
): SearchParams {
  return {
    text,
    replaceText: '',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    ...overrides,
  };
}

// Mounts a SearchPanelWidget over an in-memory document and records the match
// ranges it asks the host to scroll to. `currentMatchIndex` models the host's
// caret-relative seed: onUpdate returns the match at that index as the current
// one, or undefined to model a caret past every occurrence (no match seeded).
function createPanel(
  contents: string,
  currentMatchIndex?: number
): {
  input: HTMLInputElement;
  scrolled: MatchRange[];
  matchesText(): string | null;
  cleanup(): void;
} {
  const dom = installDom();
  const textDocument = new TextDocument<undefined>(
    'inmemory://find-search',
    contents
  );
  const containerElement = document.createElement('div');
  document.body.appendChild(containerElement);

  const scrolled: MatchRange[] = [];
  const widget = new SearchPanelWidget({
    textDocument,
    containerElement,
    defaultQuery: '',
    scrollToMatch: (nextMatch) => scrolled.push([...nextMatch] as MatchRange),
    applyReplace: () => {},
    onUpdate: (matches) =>
      currentMatchIndex === undefined ? undefined : matches[currentMatchIndex],
    onClose: () => {},
  });

  const query = (selector: string) =>
    document.querySelector<HTMLElement>(`[data-search-panel] ${selector}`);

  return {
    input: query('input[data-search]') as HTMLInputElement,
    scrolled,
    matchesText: () => query('[data-matches]')?.textContent ?? null,
    cleanup: () => {
      widget.cleanup();
      containerElement.remove();
      dom.cleanup();
    },
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(
    new window.Event('input', { bubbles: true, cancelable: true })
  );
}

function pressEnter(input: HTMLInputElement, shiftKey = false): void {
  input.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey,
      bubbles: true,
      cancelable: true,
    })
  );
}

describe('caret-relative find seeding and forward stepping (textmate-legacy)', () => {
  // "sun" occurs at offsets [0,3], [9,12], and [18,21].
  const HAYSTACK = 'sun moon sun star sun';

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — a caret strictly
  // inside an occurrence seeds find with that word, and the first find-next
  // selects the NEXT full occurrence, never re-selecting the containing one.
  test('caret strictly inside an occurrence anchors it and adds the next full occurrence', () => {
    const d = doc(HAYSTACK);
    // Caret between "s" and "u" of the second "sun" (strictly inside it).
    const midCaret = caret(0, 10);

    // The caret expands to exactly the containing occurrence, not a
    // neighboring word and not the first occurrence in the document.
    expect(expandCollapsedSelectionToWord(d, midCaret)).toEqual(
      sel(0, 9, 0, 12)
    );

    // One find-next step: the containing occurrence becomes the anchor
    // selection and the occurrence AFTER the caret is the one added. The
    // pre-caret occurrence at [0,3] is not touched.
    expect(findNexMatch(d, [midCaret])).toEqual([
      sel(0, 9, 0, 12),
      sel(0, 18, 0, 21),
    ]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — a caret sitting
  // exactly at an occurrence start selects that very occurrence as the seed
  // (not the one before or after it).
  test('caret exactly at an occurrence start seeds that occurrence', () => {
    const d = doc(HAYSTACK);
    const atStart = caret(0, 9);

    expect(expandCollapsedSelectionToWord(d, atStart)).toEqual(
      sel(0, 9, 0, 12)
    );
    expect(findNexMatch(d, [atStart])).toEqual([
      sel(0, 9, 0, 12),
      sel(0, 18, 0, 21),
    ]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — forward stepping
  // visits every occurrence exactly once: past the last occurrence it wraps to
  // the earliest unvisited one, and once all are selected it stops instead of
  // cycling forever.
  test('forward stepping cycles through all occurrences, wraps, then terminates', () => {
    const d = doc(HAYSTACK);

    const first = findNexMatch(d, [caret(0, 10)]);
    expect(first).toEqual([sel(0, 9, 0, 12), sel(0, 18, 0, 21)]);

    // Past the document end the search wraps to the occurrence before the
    // original caret.
    const second = findNexMatch(d, first!);
    expect(second).toEqual([
      sel(0, 9, 0, 12),
      sel(0, 18, 0, 21),
      sel(0, 0, 0, 3),
    ]);

    // Every occurrence is selected; stepping again finds nothing new and
    // reports it (no duplicate selections, no infinite cycle).
    expect(findNexMatch(d, second!)).toBeUndefined();
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — when the caret sits
  // past the last occurrence the seed selects none (a bare result count), and
  // stepping afterwards starts over from the first occurrence and wraps.
  test('panel with no seeded match steps from the first occurrence and wraps', async () => {
    const panel = createPanel(HAYSTACK); // host seeds no current match
    try {
      await wait(0);
      setInputValue(panel.input, 'sun');
      // All three occurrences found, but none is current.
      expect(panel.matchesText()).toBe('3 results');

      // Forward stepping starts from the top of the document...
      pressEnter(panel.input);
      expect(panel.scrolled.at(-1)).toEqual([0, 3]);
      expect(panel.matchesText()).toBe('1 of 3');

      // ...cycles through every occurrence in order...
      pressEnter(panel.input);
      expect(panel.scrolled.at(-1)).toEqual([9, 12]);
      pressEnter(panel.input);
      expect(panel.scrolled.at(-1)).toEqual([18, 21]);
      expect(panel.matchesText()).toBe('3 of 3');

      // ...and wraps back to the first one after the last.
      pressEnter(panel.input);
      expect(panel.scrolled.at(-1)).toEqual([0, 3]);
      expect(panel.matchesText()).toBe('1 of 3');
    } finally {
      panel.cleanup();
    }
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — stepping backward
  // accepts a candidate that ends exactly where the current match starts, so
  // abutting occurrences are walked one at a time instead of being skipped.
  test('backward step lands on a touching previous occurrence', async () => {
    // "aa" in "aaaa": two abutting matches [0,2] and [2,4].
    const panel = createPanel('aaaa', 1); // host seeds the second match
    try {
      await wait(0);
      setInputValue(panel.input, 'aa');
      expect(panel.matchesText()).toBe('2 of 2');

      // Previous from [2,4]: the candidate [0,2] ends exactly at the current
      // match's start and must qualify.
      pressEnter(panel.input, true);
      expect(panel.scrolled.at(-1)).toEqual([0, 2]);
      expect(panel.matchesText()).toBe('1 of 2');
    } finally {
      panel.cleanup();
    }
  });
});

describe('zero-width regex search (textmate-legacy)', () => {
  // textmate-legacy: Frameworks/selection/tests/t_find.cc — patterns that only
  // ever match empty (word boundary, lookahead, bare anchors) must terminate
  // instead of hanging, and pierre-fe's policy is to drop empty matches
  // entirely, so they report no results.
  test('boundary-only and lookahead-only patterns terminate with no matches', () => {
    const d = doc('axx bx\ncxxx');
    expect(d.search(params('\\b', { regex: true }))).toEqual([]);
    expect(d.search(params('(?=x)', { regex: true }))).toEqual([]);
    expect(d.search(params('^', { regex: true }))).toEqual([]);
    expect(d.search(params('$', { regex: true }))).toEqual([]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — a star-quantified
  // pattern can match empty at every position; the scan must still advance and
  // return exactly the non-empty runs.
  test('star-quantified pattern returns only the non-empty runs', () => {
    const d = doc('axx bx\ncxxx');
    // Runs of "x": "xx" at [1,3], "x" at [5,6], "xxx" at [8,11]. The empty
    // matches available at every other position are dropped, and the scan
    // terminates.
    expect(d.search(params('x*', { regex: true }))).toEqual([
      [1, 3],
      [5, 6],
      [8, 11],
    ]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — dot-star yields one
  // full-line match per line with no extra empty end-of-line match, and an
  // empty line yields no match at all (empty-match-drop policy).
  test('dot-star matches each non-empty line exactly once', () => {
    const d = doc('ab\n\ncd');
    expect(d.search(params('.*', { regex: true }))).toEqual([
      [0, 2],
      [4, 6],
    ]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — advancing past an
  // empty match steps by whole code points, so a pattern that matches empty
  // next to astral characters terminates and no result boundary ever lands
  // inside a surrogate pair.
  test('empty-capable patterns beside astral characters terminate with clean boundaries', () => {
    // U+1F600 occupies UTF-16 offsets 0-1; "ok" sits at [2,4].
    const emoji = doc('\u{1F600}ok');
    expect(emoji.search(params('[a-z]*', { regex: true }))).toEqual([[2, 4]]);

    // U+1D7D8 (mathematical double-struck zero) occupies offsets 0-1; "12"
    // sits at [2,4]. \d* matches empty at 0, must skip the whole astral
    // character, and returns only the real digit run.
    const digits = doc('\u{1D7D8}12');
    expect(digits.search(params('\\d*', { regex: true }))).toEqual([[2, 4]]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — the literal-search
  // degenerate analogs of an empty-capable pattern: an empty query and a query
  // longer than the document produce no matches and no scan.
  test('empty query and query longer than the document find nothing', () => {
    const d = doc('hi');
    expect(d.search(params(''))).toEqual([]);
    expect(d.search(params('hello world'))).toEqual([]);
    expect(d.findNextNonOverlappingSubstring('', [])).toBeUndefined();
    expect(
      d.findNextNonOverlappingSubstring('hello world', [])
    ).toBeUndefined();
  });
});

describe('whole-word search boundary semantics (textmate-legacy)', () => {
  // textmate-legacy: Frameworks/selection/tests/t_find.cc — an underscore is a
  // word character, so underscore-joined and letter-suffixed occurrences are
  // not whole words.
  test('underscore and letter neighbors block a whole-word match', () => {
    // "count_max" (underscore after), "count" (standalone), "counts" (letter
    // after): only the standalone occurrence at [10,15] qualifies.
    const d = doc('count_max count counts');
    expect(d.search(params('count', { wholeWord: true }))).toEqual([[10, 15]]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — hyphen and
  // punctuation neighbors are word separators, so they do not block a
  // whole-word match.
  test('hyphen, punctuation, tab, and quote neighbors allow a whole-word match', () => {
    const d = doc('count-down,count;count');
    expect(d.search(params('count', { wholeWord: true }))).toEqual([
      [0, 5],
      [11, 16],
      [17, 22],
    ]);

    const quoted = doc('tab\tmax "max"');
    expect(quoted.search(params('max', { wholeWord: true }))).toEqual([
      [4, 7],
      [9, 12],
    ]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — the document edges
  // and newline characters count as separators, so occurrences at the document
  // start/end and at line starts/ends are whole words.
  test('document edges and line boundaries count as word separators', () => {
    // Occurrences at doc start, line ends, line starts, and doc end.
    const d = doc('max\nmax max\nmax');
    expect(d.search(params('max', { wholeWord: true }))).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
      [12, 15],
    ]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — how non-ASCII
  // neighbors classify at a whole-word boundary.
  test('an adjacent emoji blocks a whole-word match', () => {
    // DIVERGENCE: pierre-fe's boundary check treats every code unit outside
    // its ASCII separator set as a word character, and it reads a single
    // UTF-16 unit, so an adjacent astral character is classified by its
    // surrogate half. An emoji neighbor therefore blocks the match, whereas a
    // symbols-are-separators convention would allow it. Coherent either way;
    // this pins the current policy.
    // Layout: emoji [0,2), "max" [2,5), " " 5, "max" [6,9), emoji [9,11),
    // " " 11, "max" [12,15).
    const d = doc('\u{1F600}max max\u{1F600} max');
    expect(d.search(params('max', { wholeWord: true }))).toEqual([[12, 15]]);
  });
});

describe('per-line regex anchor contract (textmate-legacy)', () => {
  // textmate-legacy: Frameworks/selection/tests/t_find.cc — the caret anchor
  // binds at the start of every line of the document, not just the first, and
  // an empty line offers no character for it to consume.
  test('^ matches at the start of every non-empty line', () => {
    const d = doc('abc\nxyz\n\nqrs');
    expect(d.search(params('^.', { regex: true }))).toEqual([
      [0, 1],
      [4, 5],
      [9, 10],
    ]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — the end anchor
  // binds immediately before each line's newline (and at the document end),
  // never mid-line.
  test('$ binds before each newline and at the document end', () => {
    // Every line ends in "o", and "foo" also has a mid-line "o" at offset 1
    // that must NOT match.
    const d = doc('foo\nzoo\nboo');
    expect(d.search(params('o$', { regex: true }))).toEqual([
      [2, 3],
      [6, 7],
      [10, 11],
    ]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — in a CRLF document
  // the anchors bind around the two-character line break: $ before the \r\n
  // (the match never includes \r) and ^ right after it.
  test('anchors bind around CRLF line breaks without consuming them', () => {
    const d = doc('foo\r\nzoo');
    expect(d.eol).toBe('\r\n');
    // Line 1 starts at offset 5, after both break characters.
    expect(d.search(params('o$', { regex: true }))).toEqual([
      [2, 3],
      [7, 8],
    ]);
    expect(d.search(params('^.', { regex: true }))).toEqual([
      [0, 1],
      [5, 6],
    ]);
  });

  // textmate-legacy: Frameworks/selection/tests/t_find.cc — search operates
  // line by line, so patterns that would have to span a line break (literal
  // newline/carriage-return characters or their regex escapes) are rejected
  // with no matches rather than partially applied.
  test('newline-spanning patterns are rejected outright', () => {
    const d = doc('foo\r\nzoo');
    expect(d.search(params('o\\r', { regex: true }))).toEqual([]);
    expect(d.search(params('o\\n', { regex: true }))).toEqual([]);
    expect(d.search(params('o\r'))).toEqual([]);
    expect(d.search(params('o\n'))).toEqual([]);
  });
});
