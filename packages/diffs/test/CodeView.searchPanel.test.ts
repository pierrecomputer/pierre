import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { Editor } from '../src/editor/editor';
import { TextDocument } from '../src/editor/textDocument';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
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

function dispatchFindAgain(
  target: EventTarget,
  options: { previous?: boolean; composed?: boolean } = {}
): KeyboardEvent {
  const attempts = [
    { metaKey: true, ctrlKey: false },
    { metaKey: false, ctrlKey: true },
  ];
  let lastEvent: KeyboardEvent | undefined;
  for (const modifiers of attempts) {
    const event = new window.KeyboardEvent('keydown', {
      key: 'g',
      code: 'KeyG',
      shiftKey: options.previous === true,
      bubbles: true,
      cancelable: true,
      composed: options.composed === true,
      ...modifiers,
    });
    target.dispatchEvent(event);
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

function makeSearchScrollContents(): string {
  return Array.from({ length: 600 }, (_, index) => {
    if (index === 0) {
      return 'target first';
    }
    if (index === 499) {
      return 'target second';
    }
    return `line ${index + 1}`;
  }).join('\n');
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

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

describe('CodeView search panel', () => {
  test('refreshes live file matches and highlights without a host update', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
    });
    const file = { name: 'live.txt', contents: 'old target\r\nlast line' };
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        { id: 'file', type: 'file', edit: true, file },
      ]);
      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'target');
      const editor = viewer.getEditor('file')!;
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 10 },
          },
          newText: 'unchanged prefix\r\ntarget target',
        },
      ]);
      await wait(0);
      viewer.render(true);

      expect(file.contents).toBe('old target\r\nlast line');
      expect(
        getSearchState(viewer).matches.map(
          ({ lineNumber, startCharacter, endCharacter }) => ({
            lineNumber,
            startCharacter,
            endCharacter,
          })
        )
      ).toEqual([
        { lineNumber: 2, startCharacter: 0, endCharacter: 6 },
        { lineNumber: 2, startCharacter: 7, endCharacter: 13 },
      ]);
      expect(
        getRenderedSearchMatches(root).map((element) => element.textContent)
      ).toEqual(['target', 'target']);
      editor.undo();
      await wait(0);
      viewer.render(true);
      expect(
        getSearchState(viewer).matches.map((match) => match.lineNumber)
      ).toEqual([1]);
      expect(getRenderedSearchMatches(root)).toHaveLength(1);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test.each(['split', 'unified'] as const)(
    'searches and highlights only live additions in %s edit mode',
    async (diffStyle) => {
      const dom = installDom();
      const viewer = new CodeView({
        diffStyle,
        createEditor: (type, options, key) => new Editor(type, options, key),
      });
      const fileDiff = parseDiffFromFile(
        { name: 'live.txt', contents: 'target deleted\nunchanged\n' },
        { name: 'live.txt', contents: 'target added\nunchanged\n' }
      );
      try {
        const root = createRoot();
        viewer.setup(root);
        await renderItems(viewer, [
          { id: 'diff', type: 'diff', edit: true, fileDiff },
        ]);
        dispatchPrimaryFind(root);
        await wait(0);
        fillSearch(root, 'target');
        expect(
          getSearchState(viewer).matches.map((match) => match.side)
        ).toEqual(['additions']);
        viewer.getEditor('diff')!.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 12 },
            },
            newText: 'prefix\ntarget live\ntarget again',
          },
        ]);
        await wait(0);
        viewer.render(true);

        expect(fileDiff.additionLines.join('')).toBe(
          'target added\nunchanged\n'
        );
        const matches = getSearchState(viewer).matches;
        expect(
          matches.map(({ side, lineNumber }) => ({ side, lineNumber }))
        ).toEqual([
          { side: 'additions', lineNumber: 2 },
          { side: 'additions', lineNumber: 3 },
        ]);
        const instance = viewer.getRenderedItems()[0].instance;
        if (instance.type !== 'file-diff') {
          throw new Error('Expected an editable diff');
        }
        for (const match of matches) {
          expect(
            instance.getLineIndex(match.lineNumber, 'additions')?.[
              diffStyle === 'unified' ? 0 : 1
            ]
          ).toBe(match.renderedLineIndex);
        }
        const highlights = getRenderedSearchMatches(root);
        expect(highlights.map((element) => element.textContent)).toEqual([
          'target',
          'target',
        ]);
        expect(
          highlights.every(
            (element) => element.closest('[data-deletions]') === null
          )
        ).toBe(true);
      } finally {
        viewer.cleanUp();
        dom.cleanup();
      }
    }
  );

  test('searches retained edits after the item scrolls offscreen', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
    });
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'file',
          type: 'file',
          edit: true,
          file: { name: 'live.txt', contents: 'original' },
        },
        {
          id: 'other',
          type: 'file',
          file: {
            name: 'other.txt',
            contents: Array.from({ length: 1000 }, () => 'padding').join('\n'),
          },
        },
      ]);
      const editor = viewer.getEditor('file')!;
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 8 },
          },
          newText: 'retained target',
        },
      ]);
      viewer.scrollTo({
        type: 'position',
        position: 5000,
        behavior: 'instant',
      });
      viewer.render(true);
      await wait(0);
      expect(viewer.getRenderedItems().some((item) => item.id === 'file')).toBe(
        false
      );
      expect(viewer.getEditor('file')).toBe(editor);
      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'target');
      expect(
        getSearchState(viewer).matches.map((match) => match.itemId)
      ).toEqual(['file']);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('limits live-document results to the remaining search budget', () => {
    const document = new TextDocument(
      'file:///live.txt',
      'target target\ntarget'
    );
    expect(
      document.search(
        {
          text: 'target',
          replaceText: '',
          caseSensitive: false,
          wholeWord: false,
          regex: false,
        },
        2
      )
    ).toEqual([
      [0, 6],
      [7, 13],
    ]);
  });

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

      for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
        const event = new window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
          composed: true,
          ...composing,
        });
        input?.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(root.querySelector('[data-search-panel]')).toBe(panel);
      }

      const escapeEvent = dispatchEscape(root);

      expect(escapeEvent.defaultPrevented).toBe(true);
      expect(root.querySelector('[data-search-panel]')).toBeNull();

      dispatchPrimaryFind(root);
      await wait(0);
      expect(root.querySelector('[data-search-panel]')).not.toBeNull();

      viewer.cleanUp();
      expect(root.querySelector('[data-search-panel]')).toBeNull();
      expect(dispatchPrimaryFind(root).defaultPrevented).toBe(false);
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
      ).toBe('1 of 3');
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
      expect(
        getRenderedCurrentSearchMatches(root).map(
          (element) => element.textContent
        )
      ).toEqual(['hit']);

      pressSearchEnter(root);
      await wait(0);
      await wait(0);

      expect(
        getRenderedCurrentSearchMatches(root).map(
          (element) => element.textContent
        )
      ).toEqual(['HIT']);

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

      expect(getSearchState(viewer).current?.lineNumber).toBe(1);
      expect(
        getSearchPanelRoot(root).querySelector('[data-matches]')?.textContent
      ).toBe('1 of 2');

      const firstEnter = pressSearchEnter(root);
      expect(firstEnter.defaultPrevented).toBe(true);
      expect(getSearchState(viewer).current?.lineNumber).toBe(3);
      expect(
        getSearchPanelRoot(root).querySelector('[data-matches]')?.textContent
      ).toBe('2 of 2');

      pressSearchEnter(root);
      expect(getSearchState(viewer).current?.lineNumber).toBe(1);
      expect(
        getSearchPanelRoot(root).querySelector('[data-matches]')?.textContent
      ).toBe('1 of 2');

      fillSearch(root, '');
      expect(getSearchState(viewer).matches).toEqual([]);
      expect(getSearchState(viewer).current).toBeUndefined();
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('navigates and scrolls from the root find-again shortcut', async () => {
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
            contents: makeSearchScrollContents(),
          },
        },
      ]);

      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'target');
      expect(getSearchState(viewer).current?.lineNumber).toBe(1);

      const event = dispatchFindAgain(root);
      expect(event.defaultPrevented).toBe(true);
      expect(getSearchState(viewer).current?.lineNumber).toBe(500);

      viewer.render(true);
      expect(root.scrollTop).toBeGreaterThan(0);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('keeps composed input find-again shortcut scrolls pending', async () => {
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
            contents: makeSearchScrollContents(),
          },
        },
      ]);

      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'target');
      expect(getSearchState(viewer).current?.lineNumber).toBe(1);

      const event = dispatchFindAgain(getSearchInput(root), { composed: true });
      expect(event.defaultPrevented).toBe(true);
      expect(getSearchState(viewer).current?.lineNumber).toBe(500);

      viewer.render(true);
      expect(root.scrollTop).toBeGreaterThan(0);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });
});
