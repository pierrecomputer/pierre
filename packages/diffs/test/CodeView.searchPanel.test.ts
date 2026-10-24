import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { Editor } from '../src/editor/editor';
import { TextDocument } from '../src/editor/textDocument';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';

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
    scope: { itemId: string } | undefined;
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
      composed: true,
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

function fillReplace(root: HTMLElement, value: string): HTMLInputElement {
  const input = getSearchPanelRoot(root).querySelector<HTMLInputElement>(
    'input[data-replace]'
  );
  if (input == null) {
    throw new Error('Expected replacement input');
  }
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  return input;
}

function replaceFromPanel(root: HTMLElement, all = false): void {
  getSearchPanelRoot(root)
    .querySelector<HTMLButtonElement>(
      `button[title="${all ? 'Replace All' : 'Replace'}"]`
    )!
    .click();
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

// jsdom needs a tab stop to focus contentEditable; focus still reaches the
// real editor's listeners, just as it does in the browser.
function getEditorContent(viewer: CodeView, id: string): HTMLElement {
  const content = viewer
    .getRenderedItems()
    .find((item) => item.id === id)
    ?.element.shadowRoot?.querySelector<HTMLElement>(
      '[data-code]:not([data-deletions]) > [data-content]'
    );
  if (content == null) {
    throw new Error(`Expected editor content for ${id}`);
  }
  content.tabIndex = 0;
  return content;
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
  test('replacement follows scope and retains panel state across edit-mode changes', async () => {
    const dom = installDom();
    const changes: string[] = [];
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
      onItemEditChange: (_event, item) => changes.push(item.id),
    });
    try {
      const root = createRoot();
      root.tabIndex = 0;
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'a',
          type: 'file',
          edit: true,
          file: { name: 'a.txt', contents: 'target target' },
        },
        {
          id: 'b',
          type: 'file',
          edit: true,
          file: { name: 'b.txt', contents: 'target b' },
        },
        {
          id: 'read',
          type: 'file',
          file: { name: 'read.txt', contents: 'target read' },
        },
      ]);
      dispatchPrimaryFind(root, true);
      await wait(0);
      const host = getSearchPanelHost(root);
      const panel = getSearchPanelRoot(root);
      const grid = panel.querySelector<HTMLElement>('[data-search-grid]')!;
      expect(grid.dataset.mode).toBe('find');
      expect(panel.querySelector('input[data-replace]')).toBeNull();
      fillSearch(root, 'target');
      panel
        .querySelector<HTMLButtonElement>('button[title="Match Case"]')!
        .click();
      getEditorContent(viewer, 'a').focus();
      viewer.render(true);
      await wait(0);
      expect(grid.dataset.mode).toBe('replace');
      const replacement = fillReplace(root, 'changed');
      getEditorContent(viewer, 'b').focus();
      viewer.render(true);
      await wait(0);
      replacement.focus();
      replaceFromPanel(root, true);
      viewer.render(true);
      await wait(0);
      expect(viewer.getEditor('b')!.getText()).toBe('changed b');
      expect(viewer.getEditor('a')!.getText()).toBe('target target');
      expect(viewer.getItem('read')).toMatchObject({
        file: { contents: 'target read' },
      });
      expect(changes).toEqual(['b']);
      expect(panel.activeElement).toBe(replacement);

      const outside = document.createElement('button');
      document.body.append(outside);
      outside.focus();
      viewer.render(true);
      await wait(0);
      expect(grid.dataset.mode).toBe('find');
      replaceFromPanel(root, true);
      expect(viewer.getEditor('a')!.getText()).toBe('target target');
      getEditorContent(viewer, 'a').focus();
      viewer.render(true);
      await wait(0);
      expect(grid.dataset.mode).toBe('replace');
      expect(getSearchPanelHost(root)).toBe(host);
      expect(panel.querySelector('input[data-replace]')).toBe(replacement);
      expect(replacement.value).toBe('changed');
      expect(getSearchInput(root).value).toBe('target');
      expect(
        panel
          .querySelector('button[title="Match Case"]')
          ?.getAttribute('aria-pressed')
      ).toBe('true');
      replacement.focus();
      viewer.updateItem({ ...viewer.getItem('a')!, edit: false, version: 2 });
      viewer.render(true);
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      expect(grid.dataset.mode).toBe('find');
      expect(replacement.value).toBe('changed');
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test.each(['file', 'split', 'unified'] as const)(
    'replacing a middle match advances past replacement text containing the query in %s',
    async (kind) => {
      const replacement = 'ashash';
      const dom = installDom();
      const changes: string[] = [];
      const viewer = new CodeView({
        diffStyle: kind === 'unified' ? 'unified' : 'split',
        createEditor: (type, options, key) => new Editor(type, options, key),
        onItemEditChange: (_event, item) => changes.push(item.id),
      });
      try {
        const root = createRoot();
        viewer.setup(root);
        const contents = 'ash elm ash birch ash';
        const file = { name: 'replace.txt', contents };
        await renderItems(viewer, [
          kind === 'file'
            ? { id: 'item', type: 'file', edit: true, file }
            : {
                id: 'item',
                type: 'diff',
                edit: true,
                fileDiff: parseDiffFromFile(
                  { ...file, contents: 'ash deleted' },
                  file
                ),
              },
        ]);
        const content = getEditorContent(viewer, 'item');
        content.focus();
        dispatchPrimaryFind(content, true);
        await wait(0);
        expect(
          getSearchPanelRoot(root).querySelector<HTMLElement>(
            '[data-search-grid]'
          )?.dataset.mode
        ).toBe('replace');
        fillSearch(root, 'ash');
        pressSearchEnter(root);
        expect(getSearchState(viewer).current?.startCharacter).toBe(8);
        const input = fillReplace(root, replacement);
        input.focus();
        replaceFromPanel(root);
        viewer.render(true);
        await wait(0);
        const editor = viewer.getEditor('item')!;
        expect(editor.getText()).toBe(`ash elm ${replacement} birch ash`);
        expect(getSearchState(viewer).current?.lineIndex).toBe(0);
        expect(getSearchState(viewer).current?.startCharacter).toBe(21);
        expect(getSearchState(viewer).matches).toHaveLength(4);
        expect(getSearchPanelRoot(root).activeElement).toBe(input);
        replaceFromPanel(root);
        viewer.render(true);
        await wait(0);
        expect(editor.getText()).toBe(
          `ash elm ${replacement} birch ${replacement}`
        );
        expect(getSearchState(viewer).current).toBeUndefined();
        expect(getSearchState(viewer).matches).toHaveLength(5);
        expect(changes).toEqual(['item', 'item']);
        expect(getSearchPanelRoot(root).activeElement).toBe(input);
      } finally {
        viewer.cleanUp();
        dom.cleanup();
      }
    }
  );

  test('replace all edits live scoped additions in one history step and refreshes highlights', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
    });
    try {
      const root = createRoot();
      viewer.setup(root);
      const fileDiff = parseDiffFromFile(
        { name: 'replace.txt', contents: 'target deleted\nold' },
        { name: 'replace.txt', contents: 'target target\nunchanged' }
      );
      await renderItems(viewer, [
        { id: 'diff', type: 'diff', edit: true, fileDiff },
        {
          id: 'other',
          type: 'file',
          edit: true,
          file: { name: 'other.txt', contents: 'target other' },
        },
      ]);
      const content = getEditorContent(viewer, 'diff');
      content.focus();
      dispatchPrimaryFind(content);
      await wait(0);
      fillSearch(root, 'target');
      fillReplace(root, 'new');
      replaceFromPanel(root, true);
      viewer.render(true);
      await wait(0);
      const editor = viewer.getEditor('diff')!;
      expect(editor.getText()).toBe('new new\nunchanged');
      expect(fileDiff.additionLines.join('')).toBe('target target\nunchanged');
      expect(fileDiff.deletionLines.join('')).toBe('target deleted\nold');
      expect(viewer.getEditor('other')!.getText()).toBe('target other');
      expect(getSearchState(viewer).matches).toHaveLength(0);
      expect(getRenderedSearchMatches(root)).toHaveLength(0);
      editor.undo();
      viewer.render(true);
      await wait(0);
      expect(editor.getText()).toBe('target target\nunchanged');
      expect(editor.canUndo).toBe(false);
      expect(getSearchState(viewer).matches).toHaveLength(2);
      expect(getRenderedSearchMatches(root)).toHaveLength(2);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('selects scoped file matches without editor scrolling and leaves global selections alone', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
    });
    try {
      const root = createRoot();
      root.tabIndex = 0;
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'file',
          type: 'file',
          edit: true,
          file: { name: 'search.txt', contents: 'target first\nnext target' },
        },
      ]);
      const content = getEditorContent(viewer, 'file');
      content.focus();
      dispatchPrimaryFind(content);
      await wait(0);
      const input = getSearchInput(root);
      const editor = viewer.getEditor('file')!;
      const scroll = spyOn(window.HTMLElement.prototype, 'scrollIntoView');
      fillSearch(root, 'target');
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 6 },
          direction: 1,
        },
      ]);
      pressSearchEnter(root);
      viewer.render(true);
      await wait(0);
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 1, character: 5 },
          end: { line: 1, character: 11 },
          direction: 1,
        },
      ]);
      expect(input.getRootNode()).toBe(getSearchPanelRoot(root));
      expect(getSearchPanelRoot(root).activeElement).toBe(input);
      expect(scroll).not.toHaveBeenCalled();
      dispatchFindAgain(input, { previous: true, composed: true });
      expect(editor.getViewState().selections?.[0].start.line).toBe(0);

      root.focus();
      await wait(0);
      viewer.render(true);
      const selection = editor.getViewState().selections;
      input.focus();
      pressSearchEnter(root);
      expect(getSearchState(viewer).current?.lineNumber).toBe(2);
      expect(editor.getViewState().selections).toEqual(selection);
      scroll.mockRestore();
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test.each(['split', 'unified'] as const)(
    'reveals and selects collapsed scoped diff matches in %s mode',
    async (diffStyle) => {
      const dom = installDom();
      const viewer = new CodeView({
        diffStyle,
        createEditor: (type, options, key) => new Editor(type, options, key),
      });
      try {
        const root = createRoot();
        viewer.setup(root);
        const lines = Array.from({ length: 220 }, (_, index) =>
          index === 100 ? 'hidden target' : `line ${index + 1}`
        );
        const next = [...lines];
        next[9] = 'changed';
        next[179] = 'changed again';
        await renderItems(viewer, [
          {
            id: 'diff',
            type: 'diff',
            edit: true,
            fileDiff: parseDiffFromFile(
              { name: 'context.txt', contents: lines.join('\n') },
              { name: 'context.txt', contents: next.join('\n') }
            ),
          },
        ]);
        const content = getEditorContent(viewer, 'diff');
        const instance = viewer.getRenderedItems()[0].instance;
        if (instance.type !== 'file-diff') {
          throw new Error('Expected diff instance');
        }
        expect(instance.isLineRenderable(101)).toBe(false);
        content.focus();
        dispatchPrimaryFind(content);
        await wait(0);
        const scroll = spyOn(window.HTMLElement.prototype, 'scrollIntoView');
        fillSearch(root, 'target');
        await waitFor(() => {
          viewer.render(true);
          return (
            getEditorContent(viewer, 'diff').querySelector(
              '[data-line="101"]'
            ) != null
          );
        });
        expect(instance.isLineRenderable(101)).toBe(true);
        expect(instance.isLineRenderable(210)).toBe(false);
        expect(viewer.getEditor('diff')!.getViewState().selections).toEqual([
          {
            start: { line: 100, character: 7 },
            end: { line: 100, character: 13 },
            direction: 1,
          },
        ]);
        expect(getSearchPanelRoot(root).activeElement).toBe(
          getSearchInput(root)
        );
        expect(getSearchState(viewer).scope).toEqual({ itemId: 'diff' });
        expect(scroll).not.toHaveBeenCalled();
        scroll.mockRestore();
      } finally {
        viewer.cleanUp();
        dom.cleanup();
      }
    }
  );

  test('follows editor focus, preserves panel scope, and clears scope outside CodeView', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
    });
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'a',
          type: 'file',
          edit: true,
          file: { name: 'a.txt', contents: 'target' },
        },
        {
          id: 'b',
          type: 'file',
          edit: true,
          file: { name: 'b.txt', contents: 'target target' },
        },
        {
          id: 'read',
          type: 'file',
          file: { name: 'read.txt', contents: 'target' },
        },
      ]);
      const a = getEditorContent(viewer, 'a');
      const b = getEditorContent(viewer, 'b');
      const read = viewer.getRenderedItems()[2].element;
      read.tabIndex = 0;
      a.focus();
      expect(root.querySelector('[data-search-panel]')).toBeNull();
      dispatchPrimaryFind(a);
      await wait(0);
      fillSearch(root, 'target');
      const panel = getSearchPanelHost(root);
      const input = getSearchInput(root);
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'a' });
      expect(getSearchState(viewer).matches).toHaveLength(1);

      b.focus();
      await wait(0);
      viewer.render(true);
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'b' });
      expect(getSearchState(viewer).matches).toHaveLength(2);
      expect((b.getRootNode() as ShadowRoot).activeElement).toBe(b);
      input.focus();
      dispatchPrimaryFind(input);
      dispatchFindAgain(input, { composed: true });
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'b' });
      expect(getSearchPanelHost(root)).toBe(panel);
      expect(input.value).toBe('target');

      const outside = document.createElement('button');
      document.body.append(outside);
      outside.focus();
      await wait(0);
      viewer.render(true);
      expect(getSearchState(viewer).scope).toBeUndefined();
      expect(getSearchState(viewer).matches).toHaveLength(4);
      expect(document.activeElement).toBe(outside);
      a.focus();
      await wait(0);
      read.focus();
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      dispatchPrimaryFind(read);
      expect(getSearchState(viewer).matches).toHaveLength(4);
      a.focus();
      await wait(0);
      a.blur();
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      a.focus();
      input.focus();
      input.blur();
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      a.focus();
      const itemHost = viewer.getRenderedItems()[0].element;
      itemHost.tabIndex = 0;
      itemHost.focus();
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      dispatchEscape(root);
      b.focus();
      expect(root.querySelector('[data-search-panel]')).toBeNull();
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test.each(['panel', 'editor', 'outside'] as const)(
    'host edit-mode changes preserve scope with focus on %s',
    async (focus) => {
      const dom = installDom();
      const viewer = new CodeView({
        createEditor: (type, options, key) => new Editor(type, options, key),
      });
      try {
        const root = createRoot();
        viewer.setup(root);
        await renderItems(viewer, [
          {
            id: 'a',
            type: 'file',
            edit: true,
            version: 1,
            file: { name: 'a.txt', contents: 'target' },
          },
          {
            id: 'b',
            type: 'file',
            version: 1,
            file: { name: 'b.txt', contents: 'target target' },
          },
          {
            id: 'c',
            type: 'file',
            version: 1,
            file: { name: 'c.txt', contents: 'target target target' },
          },
        ]);
        const content = getEditorContent(viewer, 'a');
        content.focus();
        dispatchPrimaryFind(content);
        viewer.render(true);
        await wait(0);
        fillSearch(root, 'target');
        if (focus === 'editor') {
          content.focus();
        } else if (focus === 'outside') {
          const outside = document.createElement('button');
          document.body.append(outside);
          outside.focus();
        }
        viewer.render(true);
        await wait(0);
        const expectedScope = focus === 'outside' ? undefined : { itemId: 'a' };
        const expectedCount = focus === 'outside' ? 6 : 1;
        viewer.updateItem({ ...viewer.getItem('b')!, edit: true, version: 2 });
        viewer.render(true);
        await wait(0);
        expect(getSearchState(viewer).scope).toEqual(expectedScope);
        expect(getSearchState(viewer).matches).toHaveLength(expectedCount);
        viewer.setItems([
          viewer.getItem('a')!,
          { ...viewer.getItem('b')!, edit: false, version: 3 },
          viewer.getItem('c')!,
        ]);
        viewer.setItems([
          viewer.getItem('a')!,
          { ...viewer.getItem('b')!, edit: true, version: 4 },
          { ...viewer.getItem('c')!, edit: true, version: 2 },
        ]);
        viewer.render(true);
        await wait(0);
        expect(getSearchState(viewer).scope).toEqual(expectedScope);
        expect(getSearchState(viewer).matches).toHaveLength(expectedCount);
        expect(getSearchInput(root).value).toBe('target');
        getEditorContent(viewer, 'b').focus();
        viewer.render(true);
        await wait(0);
        expect(getSearchState(viewer).scope).toEqual({ itemId: 'b' });
        expect(getSearchState(viewer).matches).toHaveLength(2);
      } finally {
        viewer.cleanUp();
        dom.cleanup();
      }
    }
  );

  test('updates scope for edit mode, item renaming, collapse, and removal', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
    });
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'a',
          type: 'file',
          version: 1,
          file: { name: 'a.txt', contents: 'target' },
        },
        {
          id: 'b',
          type: 'file',
          version: 1,
          file: { name: 'b.txt', contents: 'target target' },
        },
      ]);
      dispatchPrimaryFind(root);
      viewer.render(true);
      await wait(0);
      fillSearch(root, 'target');
      viewer.updateItem({ ...viewer.getItem('a')!, edit: true, version: 2 });
      viewer.render(true);
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      expect(getSearchState(viewer).matches).toHaveLength(3);
      getEditorContent(viewer, 'a').focus();
      viewer.render(true);
      await wait(0);
      getSearchInput(root).focus();
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'a' });
      expect(getSearchState(viewer).matches).toHaveLength(1);
      viewer.updateItemId('a', 'renamed');
      viewer.render(true);
      await wait(0);
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'renamed' });
      expect(getSearchState(viewer).matches[0].itemId).toBe('renamed');
      const renamedContent = getEditorContent(viewer, 'renamed');
      renamedContent.focus();
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'renamed' });
      getSearchInput(root).focus();
      viewer.updateItem({
        ...viewer.getItem('renamed')!,
        edit: false,
        version: 3,
      });
      viewer.render(true);
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      expect(getSearchState(viewer).matches).toHaveLength(3);
      viewer.setItems([
        { ...viewer.getItem('renamed')!, edit: true, version: 4 },
        viewer.getItem('b')!,
      ]);
      viewer.render(true);
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      getEditorContent(viewer, 'renamed').focus();
      viewer.render(true);
      await wait(0);
      getSearchInput(root).focus();
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'renamed' });
      viewer.updateItem({
        ...viewer.getItem('renamed')!,
        collapsed: true,
        version: 5,
      });
      viewer.render(true);
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      expect(getSearchState(viewer).matches).toHaveLength(2);
      viewer.updateItem({ ...viewer.getItem('b')!, edit: true, version: 2 });
      viewer.render(true);
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      getEditorContent(viewer, 'b').focus();
      viewer.render(true);
      await wait(0);
      getSearchInput(root).focus();
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'b' });
      viewer.removeItem('b');
      viewer.render(true);
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      expect(getSearchInput(root).value).toBe('target');
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

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
    'searches and highlights only live additions when scoped in %s mode',
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
        const content = getEditorContent(viewer, 'diff');
        content.focus();
        dispatchPrimaryFind(content);
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
        root.tabIndex = 0;
        root.focus();
        await wait(0);
        viewer.render(true);
        expect(getSearchState(viewer).scope).toBeUndefined();
        expect(
          getSearchState(viewer).matches.map(({ side, lineNumber }) => ({
            side,
            lineNumber,
          }))
        ).toEqual([
          { side: 'deletions', lineNumber: 1 },
          { side: 'additions', lineNumber: 2 },
          { side: 'additions', lineNumber: 3 },
        ]);
        expect(getRenderedSearchMatches(root)).toHaveLength(3);
        expect(
          getRenderedSearchMatches(root).some(
            (element) =>
              element.closest('[data-deletions]') !== null ||
              element.closest('[data-line-type="change-deletion"]') !== null
          )
        ).toBe(true);
      } finally {
        viewer.cleanUp();
        dom.cleanup();
      }
    }
  );

  for (const action of ['replace', 'replaceAll', 'applyEdits'] as const) {
    test.each(['file', 'split', 'unified'] as const)(
      `${action} while recycled renders the edited document after remount in %s`,
      async (kind) => {
        const dom = installDom();
        const changes: string[] = [];
        const viewer = new CodeView({
          diffStyle: kind === 'unified' ? 'unified' : 'split',
          createEditor: (type, options, key) => new Editor(type, options, key),
          onItemEditChange: (_event, item) => changes.push(item.id),
        });
        try {
          const root = createRoot();
          viewer.setup(root);
          const file = {
            name: 'replace.txt',
            contents: 'target one\nkeep\ntarget two\n',
          };
          await renderItems(viewer, [
            kind === 'file'
              ? { id: 'item', type: 'file', edit: true, file }
              : {
                  id: 'item',
                  type: 'diff',
                  edit: true,
                  fileDiff: parseDiffFromFile(
                    { ...file, contents: 'old one\nkeep\nold two\n' },
                    file
                  ),
                },
            {
              id: 'padding',
              type: 'file',
              file: { name: 'padding.txt', contents: 'padding\n'.repeat(1000) },
            },
          ]);
          const editor = viewer.getEditor('item')!;
          const content = getEditorContent(viewer, 'item');
          content.focus();
          dispatchPrimaryFind(content, true);
          await wait(0);
          fillSearch(root, 'target');
          const input = fillReplace(root, 'NEW');
          input.focus();
          const recycle = async () => {
            viewer.scrollTo({
              type: 'position',
              position: 5000,
              behavior: 'instant',
            });
            viewer.render(true);
            await wait(0);
            expect(
              viewer.getRenderedItems().some((item) => item.id === 'item')
            ).toBe(false);
            expect(getSearchState(viewer).scope).toEqual({ itemId: 'item' });
          };
          const remount = async (expected: string) => {
            viewer.scrollTo({
              type: 'position',
              position: 0,
              behavior: 'instant',
            });
            await waitFor(() => {
              viewer.render(true);
              return viewer
                .getRenderedItems()
                .some((item) => item.id === 'item');
            });
            const rows = getEditorContent(
              viewer,
              'item'
            ).querySelectorAll<HTMLElement>(
              '[data-line]:not([data-line-type="change-deletion"])'
            );
            expect(
              Array.from(rows, (row) => row.textContent)
                .join('\n')
                .replace(/\n$/, '')
            ).toBe(expected.replace(/\n$/, ''));
          };
          await recycle();
          if (action === 'applyEdits') {
            editor.applyEdits([
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 6 },
                },
                newText: 'NEW\nextra',
              },
            ]);
          } else {
            replaceFromPanel(root, action === 'replaceAll');
          }
          const expected =
            action === 'replaceAll'
              ? 'NEW one\nkeep\nNEW two\n'
              : action === 'replace'
                ? 'NEW one\nkeep\ntarget two\n'
                : 'NEW\nextra one\nkeep\ntarget two\n';
          expect(editor.getText()).toBe(expected);
          expect(changes).toEqual(['item']);
          await remount(expected);
          expect(getSearchPanelRoot(root).activeElement).toBe(input);
          await recycle();
          editor.undo();
          expect(editor.getText()).toBe(file.contents);
          expect(editor.canUndo).toBe(false);
          await remount(file.contents);
          await recycle();
          editor.redo();
          expect(editor.getText()).toBe(expected);
          await remount(expected);
          expect(changes).toEqual(['item', 'item', 'item']);
        } finally {
          viewer.cleanUp();
          dom.cleanup();
        }
      }
    );
  }

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
          newText: 'retained target target',
        },
      ]);
      const itemElement = getEditorContent(viewer, 'file');
      itemElement.focus();
      dispatchPrimaryFind(itemElement);
      await wait(0);
      fillSearch(root, 'target');
      itemElement.focus();
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
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'file' });
      expect(getSearchState(viewer).matches).toHaveLength(2);

      const input = getSearchInput(root);
      input.focus();
      pressSearchEnter(root);
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 16 },
          end: { line: 0, character: 22 },
          direction: 1,
        },
      ]);
      await waitFor(() => {
        viewer.render(true);
        return viewer.getRenderedItems().some((item) => item.id === 'file');
      });
      expect(editor.getViewState().selections?.[0].start.character).toBe(16);
      expect(getSearchPanelRoot(root).activeElement).toBe(input);

      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'target');
      expect(
        getSearchState(viewer).matches.map((match) => match.itemId)
      ).toEqual(['file', 'file']);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('searches collapsed context only while scoped or explicitly expanded', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
    });
    try {
      const root = createRoot();
      root.tabIndex = 0;
      viewer.setup(root);
      const lines = Array.from({ length: 80 }, (_, index) =>
        index === 60 ? 'hidden target' : `line ${index}`
      );
      const next = [...lines];
      next[1] = 'changed';
      await renderItems(viewer, [
        {
          id: 'diff',
          type: 'diff',
          edit: true,
          fileDiff: parseDiffFromFile(
            { name: 'context.txt', contents: lines.join('\n') },
            { name: 'context.txt', contents: next.join('\n') }
          ),
        },
      ]);
      dispatchPrimaryFind(root);
      await wait(0);
      fillSearch(root, 'target');
      expect(getSearchState(viewer).matches).toHaveLength(0);
      const content = getEditorContent(viewer, 'diff');
      content.focus();
      dispatchPrimaryFind(content);
      await wait(0);
      viewer.render(true);
      expect(
        getSearchState(viewer).matches.map(({ side, lineNumber }) => ({
          side,
          lineNumber,
        }))
      ).toEqual([{ side: 'additions', lineNumber: 61 }]);
      root.focus();
      await wait(0);
      viewer.render(true);
      expect(getSearchState(viewer).matches).toHaveLength(0);
      viewer.setOptions({
        createEditor: (type, options, key) => new Editor(type, options, key),
        expandUnchanged: true,
      });
      await wait(0);
      viewer.render(true);
      expect(getSearchState(viewer).matches.map(({ side }) => side)).toEqual([
        'deletions',
        'additions',
      ]);
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
      const reopenedPanel = getSearchPanelHost(root);
      const removeListener = spyOn(reopenedPanel, 'removeEventListener');
      getSearchPanelRoot(root)
        .querySelector<HTMLButtonElement>('[aria-label="Close"]')!
        .click();
      expect(reopenedPanel.isConnected).toBe(false);
      expect(removeListener).toHaveBeenCalledWith(
        'focusout',
        expect.any(Function)
      );
      removeListener.mockRestore();
      dispatchPrimaryFind(root);
      await wait(0);

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
