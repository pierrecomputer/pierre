import { describe, expect, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import {
  type CodeViewSearchItem,
  CodeViewSearchScan,
  MAX_SEARCH_MATCHES,
  type SearchParams,
} from '../src/search';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

const params: SearchParams = {
  text: 'target',
  replaceText: '',
  regex: false,
  wholeWord: false,
  caseSensitive: false,
};
const padding = ' '.repeat(65_536);

// One line crosses the clock boundary so each item can be changed mid-scan.
function file(itemId: string, text = 'target'): CodeViewSearchItem {
  return {
    type: 'file',
    itemId,
    contents: `${text}${padding}\n${text} tail`,
  };
}

// Controls time without replacing the documents, walkers, or matching code.
function withClock(run: () => void): void {
  const original = performance.now;
  let reads = 0;
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => reads++,
  });
  try {
    run();
  } finally {
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: original,
    });
  }
}

function createScan(items: CodeViewSearchItem[], start = 0) {
  const prepared: string[] = [];
  const scan = new CodeViewSearchScan(
    params,
    items.length,
    (position) => {
      const item = items[position];
      prepared.push(item.itemId);
      return item;
    },
    MAX_SEARCH_MATCHES,
    start
  );
  return { scan, prepared };
}

// Compares mutation results and every public lookup against a fresh search.
function finishAndCompare(
  scan: CodeViewSearchScan,
  items: CodeViewSearchItem[]
): void {
  while (!scan.finished) scan.advance(1);
  const fresh = new CodeViewSearchScan(
    params,
    items.length,
    (position) => items[position],
    MAX_SEARCH_MATCHES
  );
  fresh.advance();
  const matches = scan.getMatches();
  expect(matches).toEqual(fresh.getMatches());
  expect(scan.getMatches()).toBe(matches);
  expect(scan.hasChangedItems).toBe(false);
  for (let position = 0; position < items.length; position++) {
    const itemMatches = scan.getItemMatches(position);
    expect(itemMatches).toEqual(fresh.getItemMatches(position));
    expect(scan.isItemPending(position)).toBe(false);
    expect(scan.hasPendingItems(position, position + 1)).toBe(false);
    expect(scan.getFirstMatchedEntryAtOrAfter(position)?.position).toBe(
      fresh.getFirstMatchedEntryAtOrAfter(position)?.position
    );
    for (const match of itemMatches ?? []) {
      expect(scan.getMatchIndex(position, match)).toBe(matches.indexOf(match));
      expect(
        scan.getLineMatches(position, match.lineNumber, match.side)
      ).toEqual(fresh.getLineMatches(position, match.lineNumber, match.side));
      expect(
        scan.getFirstMatchAtOrAfter(
          position,
          match.lineNumber,
          match.startCharacter,
          match.side
        )
      ).toEqual(match);
    }
  }
  expect(scan.getFirstMatchedEntryAtOrAfter(items.length)).toBeUndefined();
}

describe('CodeViewSearchScan changed items', () => {
  test('single-item pending checks cover queued, current and unreached positions', () => {
    withClock(() => {
      const items = [
        file('a', 'absent'),
        file('b'),
        file('c'),
        file('d'),
        file('e'),
      ];
      const { scan } = createScan(items, 2);
      const checkPending = (): void => {
        for (let position = 0; position < items.length; position++) {
          expect(scan.isItemPending(position)).toBe(
            scan.hasPendingItems(position, position + 1)
          );
        }
      };
      checkPending();
      scan.advance(1);
      checkPending();
      scan.advance(1);
      expect(scan.isItemPending(2)).toBe(false);
      scan.rescanItem(2);
      expect(scan.isItemPending(2)).toBe(true);
      checkPending();
      scan.advance(1);
      expect(scan.hasChangedItems).toBe(false);
      expect(scan.isItemPending(2)).toBe(true);
      expect(scan.isItemPending(3)).toBe(false);
      checkPending();
      while (!scan.finished) {
        scan.advance(1);
        checkPending();
      }
      scan.rescanItem(0);
      scan.rescanItem(4);
      expect(scan.isItemPending(0)).toBe(true);
      expect(scan.isItemPending(2)).toBe(false);
      expect(scan.isItemPending(4)).toBe(true);
      checkPending();
      finishAndCompare(scan, items);
    });
  });

  test('unreached items read their latest contents once without entering the changed queue', () => {
    withClock(() => {
      const items = [file('a'), file('b'), file('c')];
      const { scan, prepared } = createScan(items);
      scan.advance(1);
      items[2] = file('c', 'target updated');
      scan.rescanItem(2);
      expect(scan.hasChangedItems).toBe(false);
      expect(scan.isItemPending(2)).toBe(true);
      finishAndCompare(scan, items);
      expect(prepared).toEqual(['a', 'b', 'c']);
    });
  });

  test('repeated changes abandon partial matches and refund their cap allowance', () => {
    withClock(() => {
      const items = [file('a'), file('b', 'absent')];
      const prepared: string[] = [];
      const scan = new CodeViewSearchScan(
        params,
        items.length,
        (position) => {
          prepared.push(items[position].itemId);
          return items[position];
        },
        3
      );
      scan.advance(1);
      expect(scan.getMatches()).toEqual([]);
      for (const text of ['target second', 'target third', 'target final']) {
        items[0] = file('a', text);
        scan.rescanItem(0);
        expect(scan.hasChangedItems).toBe(true);
        expect(scan.isItemPending(0)).toBe(true);
        scan.advance(1);
        expect(scan.atLimit).toBe(false);
      }
      finishAndCompare(scan, items);
      expect(prepared).toEqual(['a', 'a', 'a', 'a', 'b']);
    });
  });

  test('searched empty and matching items are queued once and do not reread unaffected items', () => {
    withClock(() => {
      const items = [file('a'), file('empty', 'absent'), file('c')];
      const { scan, prepared } = createScan(items, 1);
      finishAndCompare(scan, items);
      const current = scan.getItemMatches(2);
      items[0] = file('a', 'gone');
      items[1] = file('empty', 'target added');
      scan.rescanItem(0);
      scan.rescanItem(1);
      scan.rescanItem(1);
      expect(scan.finished).toBe(false);
      expect(scan.hasChangedItems).toBe(true);
      expect(scan.getItemMatches(0)).toBeUndefined();
      expect(scan.getItemMatches(2)).toBe(current);
      expect(scan.getMatches().map(({ itemId }) => itemId)).toEqual(['c', 'c']);
      expect(scan.hasPendingItems(0, 1)).toBe(true);
      expect(scan.hasPendingItems(1, 2)).toBe(true);
      expect(scan.hasPendingItems(2, 3)).toBe(false);
      finishAndCompare(scan, items);
      expect(prepared).toEqual(['empty', 'c', 'a', 'a', 'empty']);
      expect(scan.getItemMatches(2)).toBe(current);
    });
  });

  test('changed items wait for the current item and run before unreached items', () => {
    withClock(() => {
      const items = [file('a'), file('b'), file('c'), file('d')];
      const { scan, prepared } = createScan(items);
      scan.advance(1);
      scan.advance(1);
      expect(prepared).toEqual(['a', 'b']);
      expect(scan.getItemMatches(0)).toHaveLength(2);
      items[0] = file('a', 'target changed');
      scan.rescanItem(0);
      scan.advance(1);
      expect(prepared).toEqual(['a', 'b', 'a']);
      expect(scan.isItemPending(1)).toBe(false);
      expect(scan.isItemPending(0)).toBe(true);
      expect(scan.hasPendingItems(0, 1)).toBe(true);
      finishAndCompare(scan, items);
      expect(prepared).toEqual(['a', 'b', 'a', 'c', 'd']);
    });
  });

  test('resuming a completed scan keeps changed queue order across both runs', () => {
    withClock(() => {
      const items = [file('a'), file('b'), file('c'), file('d')];
      const { scan, prepared } = createScan(items, 2);
      finishAndCompare(scan, items);
      for (const position of [3, 0, 2]) {
        items[position] = file(items[position].itemId, 'target changed');
        scan.rescanItem(position);
      }
      finishAndCompare(scan, items);
      expect(prepared).toEqual(['c', 'd', 'a', 'b', 'd', 'a', 'c']);
    });
  });

  test('edited diff rescans retain current source coordinates in both styles and scopes', () => {
    for (const diffStyle of ['split', 'unified'] satisfies (
      | 'split'
      | 'unified'
    )[]) {
      for (const additionsOnly of [false, true]) {
        withClock(() => {
          const document = new TextDocument(
            'file:///edited',
            'target first\ntarget last'
          );
          const describeDiff = (): CodeViewSearchItem => ({
            itemId: 'diff',
            type: 'diff',
            fileDiff: parseDiffFromFile(
              { name: 'edited', contents: 'target deleted\ntarget last' },
              { name: 'edited', contents: document.getText() }
            ),
            additionContents: document.getText(),
            diffStyle,
            additionsOnly,
          });
          const items = [file('before'), describeDiff(), file('after')];
          const { scan } = createScan(items, 1);
          finishAndCompare(scan, items);
          document.applyEdits(
            [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 6 },
                },
                newText: 'gone\ntarget inserted',
              },
            ],
            false
          );
          items[1] = describeDiff();
          scan.rescanItem(1);
          finishAndCompare(scan, items);
          expect(
            scan.getItemMatches(1)?.some(({ lineNumber }) => lineNumber === 2)
          ).toBe(true);
        });
      }
    }
  });
});

describe('CodeViewSearchScan appended items', () => {
  for (const stage of ['before wrap', 'after wrap', 'finished']) {
    test(`append ${stage} preserves searched items and resumes at the new tail`, () => {
      withClock(() => {
        const items = [file('a'), file('b'), file('c')];
        const { scan, prepared } = createScan(items, 1);
        scan.advance(1);
        if (stage !== 'before wrap') {
          scan.advance(1);
          scan.advance(1);
          expect(prepared).toEqual(['b', 'c', 'a']);
        }
        if (stage === 'finished') finishAndCompare(scan, items);
        const b = scan.getItemMatches(1);
        items.push(file('d'), file('e'));
        scan.addItems(2);
        expect(scan.finished).toBe(false);
        expect(scan.isItemPending(3)).toBe(true);
        expect(scan.hasPendingItems(3, 5)).toBe(true);
        finishAndCompare(scan, items);
        if (b != null) expect(scan.getItemMatches(1)).toBe(b);
        expect(prepared).toEqual(
          stage === 'before wrap'
            ? ['b', 'c', 'd', 'e', 'a']
            : ['b', 'c', 'a', 'd', 'e']
        );
      });
    });
  }

  test('an empty view starts searching appended items', () => {
    withClock(() => {
      const items: CodeViewSearchItem[] = [];
      const { scan, prepared } = createScan(items);
      expect(scan.finished).toBe(true);
      items.push(file('first'));
      scan.addItems(1);
      finishAndCompare(scan, items);
      expect(prepared).toEqual(['first']);
    });
  });
});

describe('CodeViewSearchScan removed items', () => {
  test('removal before, at and after the start preserves current and unreached positions', () => {
    for (const start of [0, 2, 4]) {
      for (const removed of [0, 1, 2, 3, 4]) {
        for (const slices of [0, 1, 2, 4, 6]) {
          withClock(() => {
            const items = ['a', 'b', 'c', 'd', 'e'].map((id) => file(id));
            const { scan } = createScan(items, start);
            for (let slice = 0; slice < slices; slice++) scan.advance(1);
            items.splice(removed, 1);
            scan.removeItem(removed);
            finishAndCompare(scan, items);
          });
        }
      }
    }
  });

  test('removal shifts queued changes and drops a changed item without preparing it', () => {
    withClock(() => {
      const items = ['a', 'b', 'c', 'd', 'e'].map((id) => file(id));
      const { scan, prepared } = createScan(items, 2);
      finishAndCompare(scan, items);
      for (const position of [4, 0, 3, 1]) scan.rescanItem(position);
      items.splice(3, 1);
      scan.removeItem(3);
      items.splice(0, 1);
      scan.removeItem(0);
      expect(scan.isItemPending(0)).toBe(true);
      expect(scan.isItemPending(1)).toBe(false);
      expect(scan.isItemPending(2)).toBe(true);
      finishAndCompare(scan, items);
      expect(prepared).toEqual(['c', 'd', 'e', 'a', 'b', 'e', 'b']);
    });
  });

  test('removing the only current item refunds partial matches and permits a new first item', () => {
    withClock(() => {
      const items = [file('a')];
      const { scan, prepared } = createScan(items);
      scan.advance(1);
      items.splice(0, 1);
      scan.removeItem(0);
      finishAndCompare(scan, items);
      items.push(file('b'));
      scan.addItems(1);
      finishAndCompare(scan, items);
      expect(prepared).toEqual(['a', 'b']);
    });
  });

  test('removal from finished matches rebuilds joined offsets and keeps other lists', () => {
    withClock(() => {
      const items = [file('a'), file('b'), file('empty', 'gone'), file('d')];
      const { scan } = createScan(items, 2);
      finishAndCompare(scan, items);
      const d = scan.getItemMatches(3);
      items.splice(0, 1);
      scan.removeItem(0);
      expect(scan.finished).toBe(true);
      expect(scan.getItemMatches(2)).toBe(d);
      const firstD = d?.[0];
      if (firstD == null) throw new Error('Expected retained matches');
      expect(scan.getMatchIndex(2, firstD)).toBe(2);
      finishAndCompare(scan, items);
    });
  });

  test('repeated mixed mutations keep positional cursors correct after finishing and resuming', () => {
    for (const seed of [1, 17, 31, 63, 127]) {
      withClock(() => {
        let state = seed;
        let nextId = 0;
        const next = (): number => {
          state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
          return state >>> 16;
        };
        const items = ['a', 'b', 'c', 'd', 'e'].map((id) => file(id));
        const { scan } = createScan(items, seed % items.length);
        for (let step = 0; step < 40; step++) {
          const operation = next() % 4;
          if (items.length === 0 || operation === 0) {
            items.push(file(`added-${nextId++}`));
            scan.addItems(1);
          } else if (operation === 1) {
            const position = next() % items.length;
            items.splice(position, 1);
            scan.removeItem(position);
          } else if (operation === 2) {
            const position = next() % items.length;
            items[position] = file(
              items[position].itemId,
              next() % 2 === 0 ? 'target changed' : 'absent'
            );
            scan.rescanItem(position);
          } else {
            scan.advance(1);
          }
          if (step % 8 === 7) finishAndCompare(scan, items);
        }
        finishAndCompare(scan, items);
      });
    }
  });

  test('mixed changes, additions and removals equal a fresh scan', () => {
    withClock(() => {
      const items = ['a', 'b', 'c', 'd'].map((id) => file(id));
      const { scan } = createScan(items, 2);
      scan.advance(1);
      scan.advance(1);
      items[2] = file('c', 'target changed');
      scan.rescanItem(2);
      items.push(file('e'));
      scan.addItems(1);
      items.splice(0, 1);
      scan.removeItem(0);
      scan.advance(1);
      items[2] = file('d', 'gone');
      scan.rescanItem(2);
      items.splice(1, 1);
      scan.removeItem(1);
      items.push(file('f', 'target target'));
      scan.addItems(1);
      finishAndCompare(scan, items);
    });
  });
});

describe('CodeViewSearchScan mutation limits', () => {
  test('an item the limit cut short is searched again when a change makes room', () => {
    for (const change of ['rescan', 'remove']) {
      const items = [file('a'), file('b'), file('c')];
      const scan = new CodeViewSearchScan(
        params,
        items.length,
        (position) => items[position],
        5
      );
      scan.advance();
      expect(scan.atLimit).toBe(true);
      expect(scan.finished).toBe(true);
      expect(scan.getMatches().map(({ itemId }) => itemId)).toEqual([
        'a',
        'a',
        'b',
        'b',
        'c',
      ]);
      const b = scan.getItemMatches(1);
      if (change === 'rescan') {
        items[0] = file('a', 'absent');
        scan.rescanItem(0);
      } else {
        items.splice(0, 1);
        scan.removeItem(0);
      }
      expect(scan.finished).toBe(false);
      finishAndCompare(scan, items);
      expect(scan.atLimit).toBe(false);
      expect(scan.getItemMatches(change === 'rescan' ? 1 : 0)).toBe(b);
      expect(scan.getMatches().map(({ itemId }) => itemId)).toEqual([
        'b',
        'b',
        'c',
        'c',
      ]);
    }
  });

  test('a change at the limit that makes no room leaves the scan at the limit', () => {
    const items = [file('a'), file('b')];
    const scan = new CodeViewSearchScan(
      params,
      items.length,
      (position) => items[position],
      2
    );
    scan.advance();
    expect(scan.atLimit).toBe(true);
    items[0] = file('a', 'target changed');
    scan.rescanItem(0);
    expect(scan.finished).toBe(false);
    expect(scan.getMatches()).toEqual([]);
    scan.advance();
    expect(scan.atLimit).toBe(true);
    expect(scan.finished).toBe(true);
    expect(scan.getMatches().map(({ itemId }) => itemId)).toEqual(['a', 'a']);
    const matches = scan.getMatches();
    items.push(file('c'));
    scan.addItems(1);
    expect(scan.finished).toBe(true);
    expect(scan.getMatches()).toBe(matches);
  });

  test('empty and invalid queries stay finished through mutations', () => {
    for (const query of ['', '[']) {
      const items = [file('a')];
      const prepared: number[] = [];
      const scan = new CodeViewSearchScan(
        { ...params, text: query, regex: true },
        1,
        (position) => {
          prepared.push(position);
          return items[position];
        },
        MAX_SEARCH_MATCHES
      );
      scan.rescanItem(0);
      items.splice(0, 1);
      scan.removeItem(0);
      items.push(file('b'));
      scan.addItems(1);
      scan.advance(1);
      expect(scan.finished).toBe(true);
      expect(scan.getMatches()).toEqual([]);
      expect(prepared).toEqual([]);
    }
  });
});
