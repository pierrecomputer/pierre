import { describe, expect, test } from 'bun:test';

import {
  buildSearchReplacementText,
  PieceTable,
} from '../src/editor/pieceTable';
import {
  type MatchRange,
  type SearchPanelOptions,
  SearchPanelWidget,
  type SearchParams,
} from '../src/editor/searchPanel';
import type { ResolvedTextEdit } from '../src/editor/textDocument';
import { TextDocument } from '../src/editor/textDocument';
import { installDom, wait } from './domHarness';

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(
    new window.Event('input', { bubbles: true, cancelable: true })
  );
}

function pressKey(
  input: HTMLInputElement,
  key: string,
  init: KeyboardEventInit = {}
): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  input.dispatchEvent(event);
  return event;
}

interface WidgetHarness {
  widget: SearchPanelWidget;
  input: HTMLInputElement;
  replaceInput: HTMLInputElement;
  button(container: string, index: number): HTMLButtonElement;
  matchesText(): string | null;
  mode(): string | undefined;
  scrolled: MatchRange[];
  applied: ResolvedTextEdit[][];
  updates: (MatchRange[] | undefined)[];
  isClosed(): boolean;
  cleanup(): void;
}

// Mounts a SearchPanelWidget over an in-memory document and records everything
// the widget hands back to its host (scroll targets, replace edits, match-set
// updates, and close). The default onUpdate selects the first match as current,
// like the editor selecting the first hit on open; pass `selectCurrent: false`
// to model a host with no match under the caret (the "N results" state).
function createWidget(
  contents: string,
  options: {
    defaultQuery?: string;
    mode?: SearchPanelOptions['mode'];
    selectCurrent?: boolean;
  } = {}
): WidgetHarness {
  const { defaultQuery = '', mode, selectCurrent = true } = options;
  const dom = installDom();
  const textDocument = new TextDocument<undefined>(
    'inmemory://search-panel',
    contents
  );
  const containerElement = document.createElement('div');
  document.body.appendChild(containerElement);

  const scrolled: MatchRange[] = [];
  const applied: ResolvedTextEdit[][] = [];
  const updates: (MatchRange[] | undefined)[] = [];

  let closed = false;
  const widget = new SearchPanelWidget({
    textDocument,
    containerElement,
    defaultQuery,
    mode,
    scrollToMatch: (nextMatch) => scrolled.push([...nextMatch]),
    applyReplace: (edits) => applied.push(edits),
    onUpdate: (matches) => {
      updates.push(matches.map((match) => [...match] as MatchRange));
      return selectCurrent ? matches[0] : undefined;
    },
    onClose: () => {
      closed = true;
    },
  });

  const query = (selector: string) =>
    document.querySelector<HTMLElement>(`[data-search-panel] ${selector}`);

  return {
    widget,
    input: query('input[data-search]') as HTMLInputElement,
    replaceInput: query('input[data-replace]') as HTMLInputElement,
    button: (container, index) =>
      document.querySelectorAll<HTMLButtonElement>(
        `[data-search-panel] [data-${container}] button`
      )[index],
    matchesText: () => query('[data-matches]')?.textContent ?? null,
    mode: () => query('[data-search-grid]')?.dataset.mode,
    scrolled,
    applied,
    updates,
    isClosed: () => closed,
    cleanup: () => {
      widget.cleanup();
      containerElement.remove();
      dom.cleanup();
    },
  };
}

describe('SearchPanelWidget', () => {
  test('Shift+Enter in the find input navigates to the previous match', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo');

      const forward = pressKey(harness.input, 'Enter');
      expect(forward.defaultPrevented).toBe(true);
      expect(harness.scrolled.at(-1)).toEqual([4, 7]);

      const backward = pressKey(harness.input, 'Enter', { shiftKey: true });
      expect(backward.defaultPrevented).toBe(true);
      expect(harness.scrolled.at(-1)).toEqual([0, 3]);
    } finally {
      harness.cleanup();
    }
  });

  test('shows the running match position and total', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo');
      // onUpdate selects the first match, so the panel reads "1 of 3".
      expect(harness.matchesText()).toBe('1 of 3');
      pressKey(harness.input, 'Enter');
      expect(harness.matchesText()).toBe('2 of 3');
    } finally {
      harness.cleanup();
    }
  });

  test('shows a bare result count when no match is current', async () => {
    const harness = createWidget('foo foo', { selectCurrent: false });
    try {
      await wait(0);
      setInputValue(harness.input, 'foo');
      expect(harness.matchesText()).toBe('2 results');
    } finally {
      harness.cleanup();
    }
  });

  test('clears the matches and disables navigation for an empty query', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo');
      setInputValue(harness.input, '');

      expect(harness.matchesText()).toBe('No results');
      // An empty query pushes an empty match set so the editor drops its
      // highlights, and the prev/next arrows go disabled.
      expect(harness.updates.at(-1)).toEqual([]);
      expect(harness.button('search-nav', 0).disabled).toBe(true);
      expect(harness.button('search-nav', 1).disabled).toBe(true);
    } finally {
      harness.cleanup();
    }
  });

  test('wraps past the last match to the first and before the first to the last', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo'); // current = [0, 3]
      pressKey(harness.input, 'Enter'); // -> [4, 7]
      pressKey(harness.input, 'Enter'); // -> [8, 11]
      pressKey(harness.input, 'Enter'); // wraps -> [0, 3]
      expect(harness.scrolled.at(-1)).toEqual([0, 3]);

      pressKey(harness.input, 'Enter', { shiftKey: true }); // wraps -> [8, 11]
      expect(harness.scrolled.at(-1)).toEqual([8, 11]);
    } finally {
      harness.cleanup();
    }
  });

  test('replace edits the current match and collapses past it', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo'); // current = [0, 3]
      setInputValue(harness.replaceInput, 'bar');
      pressKey(harness.replaceInput, 'Enter');

      expect(harness.applied).toEqual([[{ start: 0, end: 3, text: 'bar' }]]);
      // The panel scrolls to a collapsed caret at the end of the replacement.
      expect(harness.scrolled.at(-1)).toEqual([3, 3]);
    } finally {
      harness.cleanup();
    }
  });

  test('replace all edits every match at once', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo');
      setInputValue(harness.replaceInput, 'bar');
      harness.button('replace-actions', 1).click();

      expect(harness.applied.at(-1)).toEqual([
        { start: 0, end: 3, text: 'bar' },
        { start: 4, end: 7, text: 'bar' },
        { start: 8, end: 11, text: 'bar' },
      ]);
    } finally {
      harness.cleanup();
    }
  });

  test('replace does nothing when there are no matches', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'zzz'); // no matches
      setInputValue(harness.replaceInput, 'bar');
      harness.button('replace-actions', 0).click();
      expect(harness.applied).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });

  test('cmd+f and cmd+opt+f toggle the panel between find and replace modes', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      expect(harness.mode()).toBe('find');

      pressKey(harness.input, 'f', { metaKey: true, altKey: true });
      expect(harness.mode()).toBe('replace');

      pressKey(harness.input, 'f', { metaKey: true });
      expect(harness.mode()).toBe('find');

      // setMode drives the same transition programmatically.
      harness.widget.setMode('replace');
      expect(harness.mode()).toBe('replace');
    } finally {
      harness.cleanup();
    }
  });

  test('toggling case sensitivity re-runs the search', async () => {
    const harness = createWidget('Foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo'); // case-insensitive: two matches
      expect(harness.matchesText()).toBe('1 of 2');

      const caseToggle = harness.button('search-toggles', 0);
      expect(caseToggle.ariaPressed).toBe('false');
      caseToggle.click();

      // Case sensitivity now excludes "Foo", leaving a single match.
      expect(caseToggle.ariaPressed).toBe('true');
      expect(harness.matchesText()).toBe('1 of 1');
    } finally {
      harness.cleanup();
    }
  });

  test('Escape closes the panel and notifies the host', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      const escape = pressKey(harness.input, 'Escape');
      expect(escape.defaultPrevented).toBe(true);
      expect(harness.isClosed()).toBe(true);
      expect(document.querySelector('[data-search-panel]')).toBeNull();
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Search/replace semantics exercised against PieceTable.search,
// buildSearchReplacementText, and SearchPanelWidget. pierre's search returns
// flat [start, end) document offsets (rather than row/column point ranges), so
// expectations are stated in offsets and round-tripped through positionAt
// where line geometry matters.
// ---------------------------------------------------------------------------

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
// the contract a scan-driven replace-all provides.
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
// to it. This is deliberately richer than the recording-only createWidget
// harness above — replace-progression semantics only show up when the
// document really changes underneath the panel.
function mountReplaceHost(contents: string): ReplaceHostHarness {
  const dom = installDom();
  const textDocument = new TextDocument<undefined>(
    'inmemory://replace-host',
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

describe('regex replace capture references', () => {
  test('numbered group references pull the captured text into the replacement', () => {
    expect(
      replacementsFor(
        'lily, fern',
        searchParams('(\\w+), (\\w+)', { replaceText: '$2 & $1' })
      )
    ).toEqual(['fern & lily']);
  });

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

  test('group references the pattern never captured collapse to empty text', () => {
    // DIVERGENCE: an implementation routing replacements through JS
    // String.replace would leave "$0" and out-of-range references like "$9"
    // as literal text. pierre's expandReplaceString resolves every $<digits>
    // token through match[n] ?? '', so $0 aliases the whole match and $9
    // becomes empty.
    expect(
      replacementsFor(
        'apex',
        searchParams('(ap)(ex)', { replaceText: '$0|$9|$2' })
      )
    ).toEqual(['apex||ex']);
  });

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

  test('case-insensitive expansion reflects the document casing, not the pattern', () => {
    expect(
      replacementsFor(
        'Reef',
        searchParams('(r)(eef)', { replaceText: '$1+$2', caseSensitive: false })
      )
    ).toEqual(['R+eef']);
  });

  test('literal (non-regex) mode passes dollar tokens through untouched', () => {
    expect(
      replacementsFor(
        'k1 k2',
        searchParams('k1', { replaceText: '$&-$1', regex: false })
      )
    ).toEqual(['$&-$1']);
  });

  test('lookbehind context before the match still expands its captures', () => {
    expect(
      replacementsFor(
        'k77',
        searchParams('(?<=k)(\\d+)', { replaceText: 'n$1' })
      )
    ).toEqual(['n77']);
  });

  test('lookahead context after the match still expands its captures', () => {
    expect(
      replacementsFor(
        'run!',
        searchParams('(\\w+)(?=!)', { replaceText: '<$1>' })
      )
    ).toEqual(['<run>']);
  });

  test('a lookahead that re-matches shorter on the slice still expands', () => {
    expect(
      replacementsFor('ooo', searchParams('o+(?=o)', { replaceText: '[$&]' }))
    ).toEqual(['[oo]']);
  });

  test('a pattern that matches nowhere leaves the document untouched', async () => {
    const host = mountReplaceHost('gray goose');
    try {
      await wait(0);
      host.regexToggle.click();
      setInputValue(host.queryInput, 'swan(\\w)');
      setInputValue(host.replaceInput, '$1');

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

describe('zero-width-capable patterns terminate and skip empty matches', () => {
  test('a starred pattern reports only its non-empty matches', () => {
    // DIVERGENCE: a search that reported zero-length ranges would surface
    // hits on lines without a match; pierre suppresses every empty match and
    // only advances the scan past them, so bare-empty lines contribute
    // nothing.
    expect(findAll('brook\n\nmoon', 'o*')).toEqual([
      [2, 4],
      [8, 10],
    ]);
  });

  test('bare ^ and $ anchors report no matches at all', () => {
    // DIVERGENCE: every match of a bare anchor is zero-length, and pierre
    // never reports zero-length matches; the alternative convention is one
    // empty range per row.
    expect(findAll('ivy\nelm', '^')).toEqual([]);
    expect(findAll('ivy\nelm', '$')).toEqual([]);
  });

  test('an empty alternation arm only ever surfaces the non-empty arm', () => {
    expect(findAll('ame', 'm|')).toEqual([[1, 2]]);
  });

  test('an optional pattern skips empty positions across empty lines and doc edges', () => {
    // Non-empty hits at the very first and very last offset are still found;
    // the empty middle line and every empty match in between stay silent.
    expect(findAll('d\n\nd', 'd?')).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  test('^.*$ returns whole-line ranges and stays silent on empty lines', () => {
    // Trailing newline: the empty final line yields no match either.
    expect(findAll('fig\n\nrye\n', '^.*$')).toEqual([
      [0, 3],
      [5, 8],
    ]);
  });

  test('a starred group terminates on lines where it can only match empty', () => {
    expect(findAll('axax\nbb\nax', '(?:ax)*')).toEqual([
      [0, 4],
      [8, 10],
    ]);
  });

  test('the empty-match advance steps over whole surrogate pairs', () => {
    // advancePastEmptyMatch moves the scan by one code POINT. A pattern whose
    // only non-empty alternative is a lone low surrogate can therefore never
    // fire mid-pair: the scan lands on 0, 2, 4, ... never on offset 1 or 3.
    expect(findAll('\u{1F600}\u{1F600}', '\uDE00|w*')).toEqual([]);
    // The same alternation still finds a real character after an astral one.
    expect(findAll('\u{1F600}w', '\uDE00|w*')).toEqual([[2, 3]]);
  });

  test('matches after astral characters land at UTF-16 offsets', () => {
    expect(findAll('\u{1F600}w\u{1F600}ww', 'w+')).toEqual([
      [2, 3],
      [5, 7],
    ]);
  });

  test('an invalid pattern reports zero matches instead of throwing', () => {
    // DIVERGENCE: a stricter contract would reject/throw on an unparseable
    // pattern; pierre compiles inside try/catch and treats it as "no matches".
    expect(findAll('text', '([')).toEqual([]);
  });
});

describe('anchored patterns on CRLF and mixed-EOL documents', () => {
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

  test('a trailing CRLF adds no phantom match on the empty final line', () => {
    expect(findAll('app\r\n', 'p+$')).toEqual([[1, 3]]);
    expect(findAll('app\r\n', '.$')).toEqual([[2, 3]]);
    expect(findAll('app\r\n', '^')).toEqual([]);
  });
});

describe('replace progression through the search panel', () => {
  test('replacing with text containing the query steps past the insertion', async () => {
    const host = mountReplaceHost('ash elm ash');
    try {
      await wait(0);
      setInputValue(host.queryInput, 'ash');
      expect(host.scrolled).toEqual([[0, 3]]);
      expect(host.matchesLabel()).toBe('1 of 2');

      setInputValue(host.replaceInput, 'ashash');
      pressKey(host.replaceInput, 'Enter');

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

      pressKey(host.replaceInput, 'Enter');
      expect(host.textDocument.getText()).toBe('ashash elm ashash');
      expect(host.scrolled.at(-1)).toEqual([17, 17]);
      // Nothing remains at or after the caret: the panel shows a bare count.
      expect(host.matchesLabel()).toBe('4 results');
    } finally {
      host.dispose();
    }
  });

  test('replace wraps to the document top once no match remains past the caret', async () => {
    // DIVERGENCE: a scan-driven replace would be one forward pass that stops
    // at the buffer end. pierre's panel wraps around (interactive-search
    // policy), so once forward matches are exhausted the next replace lands
    // on the first match again — including matches produced by earlier
    // replacements. Each step still edits a genuine current match.
    const host = mountReplaceHost('ash elm ash');
    try {
      await wait(0);
      setInputValue(host.queryInput, 'ash');
      setInputValue(host.replaceInput, 'ashash');
      pressKey(host.replaceInput, 'Enter'); // 'ashash elm ash', caret past [3, 6]
      pressKey(host.replaceInput, 'Enter'); // 'ashash elm ashash', caret at doc end

      pressKey(host.replaceInput, 'Enter'); // wraps: replaces [0, 3] again

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

  test('replacing with the empty string collapses the caret at the match start', async () => {
    const host = mountReplaceHost('oak elm fir');
    try {
      await wait(0);
      setInputValue(host.queryInput, 'elm');
      setInputValue(host.replaceInput, '');
      pressKey(host.replaceInput, 'Enter');

      expect(host.appliedBatches).toEqual([[{ start: 4, end: 7, text: '' }]]);
      expect(host.textDocument.getText()).toBe('oak  fir');
      expect(host.scrolled.at(-1)).toEqual([4, 4]);
      expect(host.matchesLabel()).toBe('No results');
    } finally {
      host.dispose();
    }
  });

  test('replace all over adjacency-prone runs equals one forward scan', async () => {
    const contents = 'kkkkk\nkkk k';
    const host = mountReplaceHost(contents);
    try {
      await wait(0);
      setInputValue(host.queryInput, 'kk');
      setInputValue(host.replaceInput, 'z');
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

  test('replace all with a query-containing replacement finishes in one pass', async () => {
    const contents = 'ash ashash';
    const host = mountReplaceHost(contents);
    try {
      await wait(0);
      setInputValue(host.queryInput, 'ash');
      setInputValue(host.replaceInput, 'ashash');
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

  test('replace all expands capture references per match', async () => {
    const host = mountReplaceHost('id 7 and 305');
    try {
      await wait(0);
      host.regexToggle.click();
      setInputValue(host.queryInput, '(\\d+)');
      setInputValue(host.replaceInput, '#$1#');
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

describe('search agrees with a string-model oracle under random splices', () => {
  test('100 seeded LF-only splices keep every preset pattern on the oracle', () => {
    runSearchFuzz(
      0xa70e,
      'delta gap echo 12\nfox 345 gap\n\nhollow gap 6\nquiet end 78',
      ['gap', 'e', '90', '\n', ' ', 'axe', ''],
      100
    );
  });

  test('CR/LF-biased splices keep every preset pattern on the oracle', () => {
    runSearchFuzz(
      7,
      'delta gap echo 12\r\nfox 345 gap\n\nhollow gap 6\r\nquiet end 78',
      ['gap', 'e', '90', '\n', '\r', '\r\n', ' ', ''],
      40
    );
  });
});
