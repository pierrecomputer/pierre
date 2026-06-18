import { describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { createRoot, installDom, renderItems, wait } from './domHarness';

interface SearchMatchProbe {
  itemId: string;
  itemType: 'file' | 'diff';
  side: 'deletions' | 'additions' | undefined;
  lineNumber: number;
  lineIndex: number;
  renderedLineIndex: number;
  startCharacter: number;
  endCharacter: number;
}

interface SearchStateProbe {
  searchState: {
    matches: SearchMatchProbe[];
    current: SearchMatchProbe | undefined;
  };
}

function dispatchPrimaryFind(root: HTMLElement, altKey = false): KeyboardEvent {
  const attempts = [
    { metaKey: true, ctrlKey: false },
    { metaKey: false, ctrlKey: true },
  ];
  let lastEvent: KeyboardEvent | undefined;
  for (const modifiers of attempts) {
    const event = new window.KeyboardEvent('keydown', {
      key: 'f',
      code: 'KeyF',
      altKey,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });
    root.dispatchEvent(event);
    lastEvent = event;
    if (event.defaultPrevented) {
      return event;
    }
  }
  return lastEvent!;
}

function dispatchEscape(root: HTMLElement): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  root.dispatchEvent(event);
  return event;
}

function fillSearch(root: HTMLElement, value: string): void {
  const input = getSearchInput(root);
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function getSearchPanelHost(root: HTMLElement): HTMLElement {
  const host = root.querySelector<HTMLElement>('[data-search-panel]');
  if (host === null) {
    throw new Error('Expected CodeView search panel');
  }
  return host;
}

function getSearchPanelRoot(root: HTMLElement): ShadowRoot {
  const shadowRoot = getSearchPanelHost(root).shadowRoot;
  if (shadowRoot === null) {
    throw new Error('Expected CodeView search panel shadow root');
  }
  return shadowRoot;
}

function getSearchInput(root: HTMLElement): HTMLInputElement {
  const input =
    getSearchPanelRoot(root).querySelector<HTMLInputElement>(
      'input[data-search]'
    );
  if (input === null) {
    throw new Error('Expected CodeView search input');
  }
  return input;
}

function pressSearchEnter(root: HTMLElement): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  getSearchInput(root).dispatchEvent(event);
  return event;
}

function getSearchState(viewer: CodeView): SearchStateProbe['searchState'] {
  return (viewer as unknown as SearchStateProbe).searchState;
}

function getRenderedSearchMatches(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('*')).flatMap(
    (element) =>
      Array.from(
        element.shadowRoot?.querySelectorAll<HTMLElement>(
          '[data-search-match]'
        ) ?? []
      )
  );
}

function getRenderedCurrentSearchMatches(root: HTMLElement): HTMLElement[] {
  return getRenderedSearchMatches(root).filter(
    (element) => element.dataset.searchMatchCurrent !== undefined
  );
}

function getSearchMatchSide(element: HTMLElement): string | undefined {
  if (element.closest('[data-deletions]') != null) {
    return 'deletions';
  }
  if (element.closest('[data-additions]') != null) {
    return 'additions';
  }
  if (element.closest('[data-unified]') != null) {
    return 'unified';
  }
  return undefined;
}

describe('CodeView search panel', () => {
  test('opens a find-only panel from the primary find shortcut', async () => {
    const dom = installDom();
    const viewer = new CodeView();
    try {
      const root = createRoot();
      viewer.setup(root);

      const event = dispatchPrimaryFind(root, true);
      await wait(0);

      const panel = getSearchPanelHost(root);
      const panelRoot = getSearchPanelRoot(root);
      const grid = panelRoot.querySelector<HTMLElement>('[data-search-grid]');
      const input =
        panelRoot.querySelector<HTMLInputElement>('input[data-search]');

      expect(event.defaultPrevented).toBe(true);
      expect(panel).not.toBeNull();
      expect(panel.dataset.searchPanelOverlay).toBe('');
      expect(grid?.dataset.mode).toBe('find');
      expect(panelRoot.querySelector('[data-replace]')).toBeNull();
      expect(input).not.toBeNull();
      expect(panelRoot.activeElement).toBe(input ?? null);

      const escapeEvent = dispatchEscape(root);

      expect(escapeEvent.defaultPrevented).toBe(true);
      expect(root.querySelector('[data-search-panel]')).toBeNull();

      dispatchPrimaryFind(root);
      await wait(0);
      expect(root.querySelector('[data-search-panel]')).not.toBeNull();

      viewer.cleanUp();
      expect(root.querySelector('[data-search-panel]')).toBeNull();
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('indexes matches in file items from the panel query', async () => {
    const dom = installDom();
    const viewer = new CodeView();
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'file-a',
          type: 'file',
          file: {
            name: 'file-a.ts',
            contents: 'alpha hit\nmiss\nHIT again\nhit-end\n',
          },
        },
      ]);

      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'hit');

      expect(
        getSearchState(viewer).matches.map(
          ({ lineNumber, startCharacter, endCharacter }) => ({
            lineNumber,
            startCharacter,
            endCharacter,
          })
        )
      ).toEqual([
        { lineNumber: 1, startCharacter: 6, endCharacter: 9 },
        { lineNumber: 3, startCharacter: 0, endCharacter: 3 },
        { lineNumber: 4, startCharacter: 0, endCharacter: 3 },
      ]);
      expect(
        getSearchPanelRoot(root).querySelector('[data-matches]')?.textContent
      ).toBe('3 results');
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('renders file match highlights and marks the current match', async () => {
    const dom = installDom();
    const viewer = new CodeView();
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'file-a',
          type: 'file',
          file: {
            name: 'file-a.ts',
            contents: 'alpha hit\nmiss\nHIT again\nhit-end\n',
          },
        },
      ]);

      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'hit');
      await wait(0);
      await wait(0);

      expect(
        getRenderedSearchMatches(root).map((element) => element.textContent)
      ).toEqual(['hit', 'HIT', 'hit']);
      expect(getRenderedCurrentSearchMatches(root)).toEqual([]);

      pressSearchEnter(root);
      await wait(0);
      await wait(0);

      expect(
        getRenderedCurrentSearchMatches(root).map(
          (element) => element.textContent
        )
      ).toEqual(['hit']);

      dispatchEscape(root);
      await wait(0);
      await wait(0);

      expect(getRenderedSearchMatches(root)).toEqual([]);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('indexes split diff deletion and addition cells separately', async () => {
    const dom = installDom();
    const viewer = new CodeView();
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'diff-a',
          type: 'diff',
          fileDiff: parseDiffFromFile(
            { name: 'diff-a.ts', contents: 'same\nonly-old\nsame\n' },
            { name: 'diff-a.ts', contents: 'same\nonly-new\nsame\n' }
          ),
        },
      ]);

      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'only');

      expect(
        getSearchState(viewer).matches.map(
          ({ side, lineNumber, lineIndex, renderedLineIndex }) => ({
            side,
            lineNumber,
            lineIndex,
            renderedLineIndex,
          })
        )
      ).toEqual([
        {
          side: 'deletions',
          lineNumber: 2,
          lineIndex: 1,
          renderedLineIndex: 1,
        },
        {
          side: 'additions',
          lineNumber: 2,
          lineIndex: 1,
          renderedLineIndex: 1,
        },
      ]);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('renders split diff match highlights on each side', async () => {
    const dom = installDom();
    const viewer = new CodeView();
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'diff-a',
          type: 'diff',
          fileDiff: parseDiffFromFile(
            { name: 'diff-a.ts', contents: 'same\nonly-old\nsame\n' },
            { name: 'diff-a.ts', contents: 'same\nonly-new\nsame\n' }
          ),
        },
      ]);

      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'only');
      await wait(0);
      await wait(0);

      expect(
        getRenderedSearchMatches(root).map((element) => ({
          side: getSearchMatchSide(element),
          text: element.textContent,
        }))
      ).toEqual([
        { side: 'deletions', text: 'only' },
        { side: 'additions', text: 'only' },
      ]);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('indexes unified diff rows in rendered row order', async () => {
    const dom = installDom();
    const viewer = new CodeView({ diffStyle: 'unified' });
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'diff-a',
          type: 'diff',
          fileDiff: parseDiffFromFile(
            { name: 'diff-a.ts', contents: 'same\nonly-old\nsame\n' },
            { name: 'diff-a.ts', contents: 'same\nonly-new\nsame\n' }
          ),
        },
      ]);

      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'only');

      expect(
        getSearchState(viewer).matches.map(({ side, renderedLineIndex }) => ({
          side,
          renderedLineIndex,
        }))
      ).toEqual([
        { side: 'deletions', renderedLineIndex: 1 },
        { side: 'additions', renderedLineIndex: 2 },
      ]);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('navigates indexed matches from the search panel', async () => {
    const dom = installDom();
    const viewer = new CodeView();
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'file-a',
          type: 'file',
          file: {
            name: 'file-a.ts',
            contents: 'first hit\nmiss\nsecond hit\n',
          },
        },
      ]);

      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'hit');

      expect(getSearchState(viewer).current).toBeUndefined();

      const firstEnter = pressSearchEnter(root);
      expect(firstEnter.defaultPrevented).toBe(true);
      expect(getSearchState(viewer).current?.lineNumber).toBe(1);
      expect(
        getSearchPanelRoot(root).querySelector('[data-matches]')?.textContent
      ).toBe('1 of 2');

      pressSearchEnter(root);
      expect(getSearchState(viewer).current?.lineNumber).toBe(3);
      expect(
        getSearchPanelRoot(root).querySelector('[data-matches]')?.textContent
      ).toBe('2 of 2');

      fillSearch(root, '');
      expect(getSearchState(viewer).matches).toEqual([]);
      expect(getSearchState(viewer).current).toBeUndefined();
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });
});
