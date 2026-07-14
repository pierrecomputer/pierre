import { describe, expect, test } from 'bun:test';

import {
  buildSearchReplacementText,
  PieceTable,
} from '../../src/editor/pieceTable';
import type { MatchRange, SearchParams } from '../../src/editor/searchPanel';
import { SearchPanelWidget } from '../../src/editor/searchPanel';
import type { ResolvedTextEdit } from '../../src/editor/textDocument';
import { TextDocument } from '../../src/editor/textDocument';
import { installDom, wait } from '../domHarness';

// Search/replace semantics harvested from Atom's text-buffer scan/replace
// specs and superstring's findAll tests, re-expressed against PieceTable.search,
// buildSearchReplacementText, and SearchPanelWidget. Atom addresses matches as
// Range(Point(row, column)) pairs (0-based); pierre's search returns flat
// [start, end) document offsets, so expectations are stated in offsets and
// round-tripped through positionAt where line geometry matters.

function searchParams(
  text: string,
  overrides: Partial<SearchParams> = {}
): SearchParams {
  return {
    text,
    replaceText: '',
    caseSensitive: true,
    wholeWord: false,
    regex: true,
    ...overrides,
  };
}

function findAll(
  docText: string,
  pattern: string,
  overrides: Partial<SearchParams> = {}
): [number, number][] {
  return new PieceTable(docText).search(searchParams(pattern, overrides));
}

// Builds the per-match replacement text the panel would insert for every match
// of `params` in `docText`, through the same positionAt/offsetAt/getLineText
// plumbing searchPanel.ts wires up.
function replacementsFor(docText: string, params: SearchParams): string[] {
  const table = new PieceTable(docText);
  return table.search(params).map(([start, end]) =>
    buildSearchReplacementText(
      (offset) => table.positionAt(offset),
      (position) => table.offsetAt(position),
      (line) => table.getLineText(line),
      params,
      start,
      end
    )
  );
}

// Reference model for replace-all: one forward pass over the raw string,
// resuming AFTER each replacement so inserted text is never re-examined —
// the contract Atom's scan-driven replace provides.
function forwardScanReplaceAll(
  text: string,
  query: string,
  replacement: string
): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith(query, i)) {
      out += replacement;
      i += query.length;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(
    new window.Event('input', { bubbles: true, cancelable: true })
  );
}

function pressEnter(input: HTMLInputElement): void {
  input.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
  );
}

interface ReplaceHostHarness {
  textDocument: TextDocument<undefined>;
  queryInput: HTMLInputElement;
  replaceInput: HTMLInputElement;
  regexToggle: HTMLButtonElement;
  replaceButton: HTMLButtonElement;
  replaceAllButton: HTMLButtonElement;
  scrolled: MatchRange[];
  appliedBatches: ResolvedTextEdit[][];
  matchesLabel(): string | null;
  dispose(): void;
}

// Mounts a SearchPanelWidget over a live document with a host wired the way
// editor.ts wires it: scrollToMatch moves a host-side selection (an offset
// pair), applyReplace actually writes the edits into the document, and
// onUpdate picks the first match at or after the selection start and scrolls
// to it. This is deliberately richer than the recording-only host in
// editorSearchPanel.test.ts — replace-progression semantics only show up when
// the document really changes underneath the panel.
function mountReplaceHost(contents: string): ReplaceHostHarness {
  const dom = installDom();
  const textDocument = new TextDocument<undefined>(
    'inmemory://atom-replace',
    contents
  );
  const containerElement = document.createElement('div');
  document.body.appendChild(containerElement);

  let selection: MatchRange = [0, 0];
  const scrolled: MatchRange[] = [];
  const appliedBatches: ResolvedTextEdit[][] = [];

  const scrollToMatch = (nextMatch: MatchRange) => {
    selection = [nextMatch[0], nextMatch[1]];
    scrolled.push([nextMatch[0], nextMatch[1]]);
  };

  const widget = new SearchPanelWidget({
    textDocument,
    containerElement,
    defaultQuery: '',
    mode: 'replace',
    scrollToMatch,
    applyReplace: (edits) => {
      appliedBatches.push(edits);
      textDocument.applyEdits(
        edits.map((edit) => ({
          range: {
            start: textDocument.positionAt(edit.start),
            end: textDocument.positionAt(edit.end),
          },
          newText: edit.text,
        }))
      );
    },
    onUpdate: (matches) => {
      for (const match of matches) {
        if (match[0] >= selection[0]) {
          scrollToMatch(match);
          return match;
        }
      }
      return undefined;
    },
    onClose: () => {},
  });

  const panel = (selector: string) =>
    document.querySelector<HTMLElement>(`[data-search-panel] ${selector}`);
  const buttons = (container: string) =>
    document.querySelectorAll<HTMLButtonElement>(
      `[data-search-panel] [data-${container}] button`
    );

  return {
    textDocument,
    queryInput: panel('input[data-search]') as HTMLInputElement,
    replaceInput: panel('input[data-replace]') as HTMLInputElement,
    regexToggle: buttons('search-toggles')[2],
    replaceButton: buttons('replace-actions')[0],
    replaceAllButton: buttons('replace-actions')[1],
    scrolled,
    appliedBatches,
    matchesLabel: () => panel('[data-matches]')?.textContent ?? null,
    dispose: () => {
      widget.cleanup();
      containerElement.remove();
      dom.cleanup();
    },
  };
}

describe('regex replace capture references (atom-legacy)', () => {
  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.js — "replaces tstat_fvars()->curr_setpoint[HEAT_EN] with tstat_set_curr_setpoint($1, $2);"
  test('numbered group references pull the captured text into the replacement', () => {
    expect(
      replacementsFor(
        'lily, fern',
        searchParams('(\\w+), (\\w+)', { replaceText: '$2 & $1' })
      )
    ).toEqual(['fern & lily']);
  });

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.js — "replaces tstat_fvars()->curr_setpoint[HEAT_EN] with tstat_set_curr_setpoint($1, $2);"
  test('$& injects the whole match and $$ escapes to one literal dollar', () => {
    expect(
      replacementsFor(
        'total 88 units',
        searchParams('\\d+', { replaceText: '($&)$$' })
      )
    ).toEqual(['(88)$']);
    // $$1 consumes the doubled dollar first, leaving a literal "$1" behind.
    expect(
      replacementsFor('apex', searchParams('(ap)(ex)', { replaceText: '$$1' }))
    ).toEqual(['$1']);
  });

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.js — "replaces atom/flight-manualatomio with $1"
  test('group references the pattern never captured collapse to empty text', () => {
    // DIVERGENCE: Atom routes replacements through JS String.replace, which
    // leaves "$0" and out-of-range references like "$9" as literal text.
    // pierre's expandReplaceString resolves every $<digits> token through
    // match[n] ?? '', so $0 aliases the whole match and $9 becomes empty.
    expect(
      replacementsFor(
        'apex',
        searchParams('(ap)(ex)', { replaceText: '$0|$9|$2' })
      )
    ).toEqual(['apex||ex']);
  });

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.js — "replaces foo( with bar( using /\bfoo\(\b/gim"
  test('anchors and word boundaries inside the match expand normally', () => {
    // ^, $, and \b context that coincides with the match edges survives the
    // slice re-execution, so expansion works for these patterns.
    expect(
      replacementsFor(
        'stem',
        searchParams('^(st)(em)$', { replaceText: '$2$1' })
      )
    ).toEqual(['emst']);
    expect(
      replacementsFor(
        'go north',
        searchParams('\\b(n\\w+)', { replaceText: '[$1]' })
      )
    ).toEqual(['[north]']);
  });

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — "does a case-insensitive search"
  test('case-insensitive expansion reflects the document casing, not the pattern', () => {
    expect(
      replacementsFor(
        'Reef',
        searchParams('(r)(eef)', { replaceText: '$1+$2', caseSensitive: false })
      )
    ).toEqual(['R+eef']);
  });

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.js — "replaces atom/flight-manualatomio with $1"
  test('literal (non-regex) mode passes dollar tokens through untouched', () => {
    expect(
      replacementsFor(
        'k1 k2',
        searchParams('k1', { replaceText: '$&-$1', regex: false })
      )
    ).toEqual(['$&-$1']);
  });

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.js — "replaces tstat_fvars()->curr_setpoint[HEAT_EN] with tstat_set_curr_setpoint($1, $2);"
  // KNOWN BUG: buildSearchReplacementText re-executes the pattern against only
  // the matched slice; a lookbehind's context sits before the slice, so the
  // re-execution finds nothing, falls back to the raw replaceText, and the
  // literal "$1" is inserted into the document.
  test.failing(
    'lookbehind context before the match still expands its captures',
    () => {
      expect(
        replacementsFor(
          'k77',
          searchParams('(?<=k)(\\d+)', { replaceText: 'n$1' })
        )
      ).toEqual(['n77']);
    }
  );

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.js — "replaces tstat_fvars()->curr_setpoint[HEAT_EN] with tstat_set_curr_setpoint($1, $2);"
  // KNOWN BUG: a lookahead's context sits after the matched slice, so the
  // slice-only re-execution fails and the unexpanded replaceText is inserted.
  test.failing(
    'lookahead context after the match still expands its captures',
    () => {
      expect(
        replacementsFor(
          'run!',
          searchParams('(\\w+)(?=!)', { replaceText: '<$1>' })
        )
      ).toEqual(['<run>']);
    }
  );

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "handles patterns with lookahead that span several chunks"
  // KNOWN BUG: on the matched slice the lookahead re-matches SHORTER than the
  // original match (the trailing context character is part of the slice), the
  // full-length guard rejects it, and the literal "[$&]" is inserted.
  test.failing(
    'a lookahead that re-matches shorter on the slice still expands',
    () => {
      expect(
        replacementsFor('ooo', searchParams('o+(?=o)', { replaceText: '[$&]' }))
      ).toEqual(['[oo]']);
    }
  );

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.js — "replaces atom/flight-manualatomio with $1"
  test('a pattern that matches nowhere leaves the document untouched', async () => {
    const host = mountReplaceHost('gray goose');
    try {
      await wait(0);
      host.regexToggle.click();
      setInput(host.queryInput, 'swan(\\w)');
      setInput(host.replaceInput, '$1');

      host.replaceButton.click();
      host.replaceAllButton.click();

      expect(host.appliedBatches).toEqual([]);
      expect(host.textDocument.getText()).toBe('gray goose');
      expect(host.matchesLabel()).toBe('No results');
    } finally {
      host.dispose();
    }
  });
});

describe('zero-width-capable patterns terminate and skip empty matches (atom-legacy)', () => {
  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "handles patterns that match the empty string (regression)"
  test('a starred pattern reports only its non-empty matches', () => {
    // DIVERGENCE: Atom's findAllSync(/^a*/) reports zero-length ranges on
    // lines without a match; pierre suppresses every empty match and only
    // advances the scan past them, so bare-empty lines contribute nothing.
    expect(findAll('brook\n\nmoon', 'o*')).toEqual([
      [2, 4],
      [8, 10],
    ]);
  });

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "does not skip empty rows"
  test('bare ^ and $ anchors report no matches at all', () => {
    // DIVERGENCE: every match of a bare anchor is zero-length, and pierre
    // never reports zero-length matches; Atom returns one empty range per row.
    expect(findAll('ivy\nelm', '^')).toEqual([]);
    expect(findAll('ivy\nelm', '$')).toEqual([]);
  });

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "handles patterns that match the empty string (regression)"
  test('an empty alternation arm only ever surfaces the non-empty arm', () => {
    expect(findAll('ame', 'm|')).toEqual([[1, 2]]);
  });

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "handles patterns that match the empty string (regression)"
  test('an optional pattern skips empty positions across empty lines and doc edges', () => {
    // Non-empty hits at the very first and very last offset are still found;
    // the empty middle line and every empty match in between stay silent.
    expect(findAll('d\n\nd', 'd?')).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "does not skip empty rows"
  test('^.*$ returns whole-line ranges and stays silent on empty lines', () => {
    // Trailing newline: the empty final line yields no match either.
    expect(findAll('fig\n\nrye\n', '^.*$')).toEqual([
      [0, 3],
      [5, 8],
    ]);
  });

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "handles patterns that match the empty string (regression)"
  test('a starred group terminates on lines where it can only match empty', () => {
    expect(findAll('axax\nbb\nax', '(?:ax)*')).toEqual([
      [0, 4],
      [8, 10],
    ]);
  });

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "handles patterns that match the empty string (regression)"
  test('the empty-match advance steps over whole surrogate pairs', () => {
    // advancePastEmptyMatch moves the scan by one code POINT. A pattern whose
    // only non-empty alternative is a lone low surrogate can therefore never
    // fire mid-pair: the scan lands on 0, 2, 4, ... never on offset 1 or 3.
    expect(findAll('\u{1F600}\u{1F600}', '\uDE00|w*')).toEqual([]);
    // The same alternation still finds a real character after an astral one.
    expect(findAll('\u{1F600}w', '\uDE00|w*')).toEqual([[2, 3]]);
  });

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "handles patterns that match the empty string (regression)"
  test('matches after astral characters land at UTF-16 offsets', () => {
    expect(findAll('\u{1F600}w\u{1F600}ww', 'w+')).toEqual([
      [2, 3],
      [5, 7],
    ]);
  });

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "throws an exception if an invalid pattern is passed"
  test('an invalid pattern reports zero matches instead of throwing', () => {
    // DIVERGENCE: Atom's find rejects/throws on an unparseable pattern;
    // pierre compiles inside try/catch and treats it as "no matches".
    expect(findAll('text', '([')).toEqual([]);
  });
});

describe('anchored patterns on CRLF and mixed-EOL documents (atom-legacy)', () => {
  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "handles the ^ and $ anchors properly (CRLF line endings)"
  test('$-anchored matches end before the \\r of each CRLF pair', () => {
    const crlfDoc = 'oak\r\nelm\r\nfir';
    const table = new PieceTable(crlfDoc);
    const hits = table.search(searchParams('\\w$'));

    expect(hits).toEqual([
      [2, 3],
      [7, 8],
      [12, 13],
    ]);
    for (const [start, end] of hits) {
      // The matched range never covers EOL bytes...
      expect(crlfDoc.slice(start, end)).not.toMatch(/[\r\n]/);
      // ...and the end offset round-trips to the line's content end.
      const endPosition = table.positionAt(end);
      expect(endPosition.character).toBe(table.getLineLength(endPosition.line));
      expect(table.offsetAt(endPosition)).toBe(end);
    }
  });

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "handles the ^ and $ anchors properly"
  test('^ matches at column 0 after CRLF, lone \\r, and \\n breaks alike', () => {
    const mixedDoc = 'ash\r\nbay\rcedar\ndate';
    const table = new PieceTable(mixedDoc);

    expect(table.search(searchParams('^\\w+'))).toEqual([
      [0, 3],
      [5, 8],
      [9, 14],
      [15, 19],
    ]);
    for (const [start] of table.search(searchParams('^\\w+'))) {
      expect(table.positionAt(start).character).toBe(0);
    }
    // $ on the same document: every end offset stops short of its line break.
    expect(table.search(searchParams('\\w$'))).toEqual([
      [2, 3],
      [7, 8],
      [13, 14],
      [18, 19],
    ]);
  });

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "handles empty matches before CRLF line endings (regression)"
  test('a trailing CRLF adds no phantom match on the empty final line', () => {
    expect(findAll('app\r\n', 'p+$')).toEqual([[1, 3]]);
    expect(findAll('app\r\n', '.$')).toEqual([[2, 3]]);
    expect(findAll('app\r\n', '^')).toEqual([]);
  });
});

describe('replace progression through the search panel (atom-legacy)', () => {
  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — "replaces each occurrence of the regex match with the string"
  test('replacing with text containing the query steps past the insertion', async () => {
    const host = mountReplaceHost('ash elm ash');
    try {
      await wait(0);
      setInput(host.queryInput, 'ash');
      expect(host.scrolled).toEqual([[0, 3]]);
      expect(host.matchesLabel()).toBe('1 of 2');

      setInput(host.replaceInput, 'ashash');
      pressEnter(host.replaceInput);

      expect(host.appliedBatches).toEqual([
        [{ start: 0, end: 3, text: 'ashash' }],
      ]);
      expect(host.textDocument.getText()).toBe('ashash elm ash');
      // The caret collapses at the END of the 6-char replacement ([6, 6], not
      // [3, 3] where the old match ended), and the next current match is the
      // one past the insertion — [11, 14], never [3, 6] which sits entirely
      // inside the text this replace just produced.
      expect(host.scrolled).toEqual([
        [0, 3],
        [6, 6],
        [11, 14],
      ]);
      expect(host.matchesLabel()).toBe('3 of 3');

      pressEnter(host.replaceInput);
      expect(host.textDocument.getText()).toBe('ashash elm ashash');
      expect(host.scrolled.at(-1)).toEqual([17, 17]);
      // Nothing remains at or after the caret: the panel shows a bare count.
      expect(host.matchesLabel()).toBe('4 results');
    } finally {
      host.dispose();
    }
  });

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — "replaces each occurrence of the regex match with the string"
  test('replace wraps to the document top once no match remains past the caret', async () => {
    // DIVERGENCE: Atom's scan-driven replace is one forward pass that stops at
    // the buffer end. pierre's panel wraps around (VS Code-style interactive
    // policy), so once forward matches are exhausted the next replace lands on
    // the first match again — including matches produced by earlier
    // replacements. Each step still edits a genuine current match.
    const host = mountReplaceHost('ash elm ash');
    try {
      await wait(0);
      setInput(host.queryInput, 'ash');
      setInput(host.replaceInput, 'ashash');
      pressEnter(host.replaceInput); // 'ashash elm ash', caret past [3, 6]
      pressEnter(host.replaceInput); // 'ashash elm ashash', caret at doc end

      pressEnter(host.replaceInput); // wraps: replaces [0, 3] again

      expect(host.textDocument.getText()).toBe('ashashash elm ashash');
      expect(host.scrolled).toEqual([
        [0, 3],
        [6, 6],
        [11, 14],
        [17, 17],
        [0, 3], // the wrap target selected by the third replace
        [6, 6],
        [6, 9],
      ]);
      expect(host.matchesLabel()).toBe('3 of 5');
    } finally {
      host.dispose();
    }
  });

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — "allows the match to be replaced with the empty string"
  test('replacing with the empty string collapses the caret at the match start', async () => {
    const host = mountReplaceHost('oak elm fir');
    try {
      await wait(0);
      setInput(host.queryInput, 'elm');
      setInput(host.replaceInput, '');
      pressEnter(host.replaceInput);

      expect(host.appliedBatches).toEqual([[{ start: 4, end: 7, text: '' }]]);
      expect(host.textDocument.getText()).toBe('oak  fir');
      expect(host.scrolled.at(-1)).toEqual([4, 4]);
      expect(host.matchesLabel()).toBe('No results');
    } finally {
      host.dispose();
    }
  });

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — "replaces each occurrence of the regex match with the string"
  test('replace all over adjacency-prone runs equals one forward scan', async () => {
    const contents = 'kkkkk\nkkk k';
    const host = mountReplaceHost(contents);
    try {
      await wait(0);
      setInput(host.queryInput, 'kk');
      setInput(host.replaceInput, 'z');
      host.replaceAllButton.click();

      expect(host.appliedBatches).toEqual([
        [
          { start: 0, end: 2, text: 'z' },
          { start: 2, end: 4, text: 'z' },
          { start: 6, end: 8, text: 'z' },
        ],
      ]);
      const expected = forwardScanReplaceAll(contents, 'kk', 'z');
      expect(expected).toBe('zzk\nzk k');
      expect(host.textDocument.getText()).toBe(expected);
    } finally {
      host.dispose();
    }
  });

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — "replaces each occurrence of the regex match with the string"
  test('replace all with a query-containing replacement finishes in one pass', async () => {
    const contents = 'ash ashash';
    const host = mountReplaceHost(contents);
    try {
      await wait(0);
      setInput(host.queryInput, 'ash');
      setInput(host.replaceInput, 'ashash');
      host.replaceAllButton.click();

      // One batch, built from the pre-replacement match set: the matches the
      // replacements introduce are never themselves replaced.
      expect(host.appliedBatches).toHaveLength(1);
      const expected = forwardScanReplaceAll(contents, 'ash', 'ashash');
      expect(expected).toBe('ashash ashashashash');
      expect(host.textDocument.getText()).toBe(expected);
    } finally {
      host.dispose();
    }
  });

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.js — "replaces tstat_fvars()->curr_setpoint[HEAT_EN] with tstat_set_curr_setpoint($1, $2);"
  test('replace all expands capture references per match', async () => {
    const host = mountReplaceHost('id 7 and 305');
    try {
      await wait(0);
      host.regexToggle.click();
      setInput(host.queryInput, '(\\d+)');
      setInput(host.replaceInput, '#$1#');
      host.replaceAllButton.click();

      expect(host.appliedBatches).toEqual([
        [
          { start: 3, end: 4, text: '#7#' },
          { start: 9, end: 12, text: '#305#' },
        ],
      ]);
      expect(host.textDocument.getText()).toBe('id #7# and #305#');
    } finally {
      host.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// search-vs-reference fuzz
// ---------------------------------------------------------------------------

// Deterministic LCG, same shape as the fuzz driver in editorPieceTable.test.ts.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Independent line-splitting oracle: \n, lone \r, and \r\n (one break) — the
// same policy as computeLineOffsets.
function oracleLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      starts.push(i + 1);
    } else if (code === 13) {
      if (i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
        i++;
      }
      starts.push(i + 1);
    }
  }
  return starts;
}

// String-based reference for PieceTable.search's documented contract: match
// line by line over break-stripped line text, drop zero-length matches, and
// map to document offsets. The whole-word check treats document edges and any
// charCode <= 32 as separators — equivalent to the production policy for the
// letters/digits/space/EOL alphabet the fuzz below sticks to.
function oracleSearchMatches(
  text: string,
  source: string,
  wholeWord: boolean
): [number, number][] {
  const out: [number, number][] = [];
  const starts = oracleLineStarts(text);
  const isSeparator = (ch: string | undefined) =>
    ch === undefined || ch.charCodeAt(0) <= 32;

  for (let line = 0; line < starts.length; line++) {
    const spanEnd = line + 1 < starts.length ? starts[line + 1] : text.length;
    let contentEnd = spanEnd;
    while (
      contentEnd > starts[line] &&
      (text[contentEnd - 1] === '\n' || text[contentEnd - 1] === '\r')
    ) {
      contentEnd--;
    }
    const lineText = text.slice(starts[line], contentEnd);
    const pattern = new RegExp(source, 'gm');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(lineText)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex = match.index + 1;
        continue;
      }
      const start = starts[line] + match.index;
      const end = start + match[0].length;
      if (
        !wholeWord ||
        (isSeparator(text[start - 1]) && isSeparator(text[end]))
      ) {
        out.push([start, end]);
      }
      if (match.index === pattern.lastIndex) {
        pattern.lastIndex++;
      }
    }
  }
  return out;
}

// Anchored, character-class, zero-width-capable, lookahead, and whole-word
// probes — one of each family the search machinery special-cases.
const FUZZ_PRESETS: { source: string; wholeWord?: boolean }[] = [
  { source: '^[a-h]+' },
  { source: '[0-9]+$' },
  { source: '[aeiou][a-z]' },
  { source: 'e*' },
  { source: '[a-z]+(?=[0-9])' },
  { source: 'gap', wholeWord: true },
];

function runSearchFuzz(
  seed: number,
  baseText: string,
  inserts: readonly string[],
  iterations: number
): void {
  const random = createRandom(seed);
  let text = baseText;
  const table = new PieceTable(text);

  for (let i = 0; i < iterations; i++) {
    if (random() < 0.6) {
      const insert = inserts[Math.floor(random() * inserts.length)];
      const offset = Math.floor(random() * (text.length + 1));
      table.insert(insert, offset);
      text = text.slice(0, offset) + insert + text.slice(offset);
    } else {
      const offset = Math.floor(random() * (text.length + 1));
      const length = Math.floor(random() * 5);
      table.delete(offset, length);
      text = text.slice(0, offset) + text.slice(offset + length);
    }
    expect(table.getText()).toBe(text);

    for (const preset of FUZZ_PRESETS) {
      const got = table.search(
        searchParams(preset.source, { wholeWord: preset.wholeWord ?? false })
      );
      const want = oracleSearchMatches(
        text,
        preset.source,
        preset.wholeWord ?? false
      );
      expect(got).toEqual(want);
    }
  }
}

describe('search agrees with a string-model oracle under random splices (atom-legacy)', () => {
  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "returns the same results as a reference implementation"
  test('100 seeded LF-only splices keep every preset pattern on the oracle', () => {
    runSearchFuzz(
      0xa70e,
      'delta gap echo 12\nfox 345 gap\n\nhollow gap 6\nquiet end 78',
      ['gap', 'e', '90', '\n', ' ', 'axe', ''],
      100
    );
  });

  // atom-legacy: atom-superstring/test/js/text-buffer.test.js — "returns the same results as a reference implementation"
  // KNOWN BUG: splices that split or form \r\n pairs across piece seams
  // corrupt the piece-level line-break counts (breaks double-counted or
  // missed — the root cause is pinned as directed repros in
  // ../monaco-legacy-tests/pieceTable.monaco.test.ts), so line starts drift
  // and search reports shifted or missing ranges even though getText() stays
  // correct. A replace driven by those ranges would edit the wrong bytes.
  test.failing(
    'CR/LF-biased splices keep every preset pattern on the oracle',
    () => {
      runSearchFuzz(
        7,
        'delta gap echo 12\r\nfox 345 gap\n\nhollow gap 6\r\nquiet end 78',
        ['gap', 'e', '90', '\n', '\r', '\r\n', ' ', ''],
        40
      );
    }
  );
});
