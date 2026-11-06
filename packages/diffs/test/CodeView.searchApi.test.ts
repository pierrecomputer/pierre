import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import type { SearchPanelState } from '../src';
import { CodeView, type CodeViewOptions } from '../src/components/CodeView';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import {
  dispatchEscape,
  dispatchFindAgain,
  dispatchPrimaryFind,
  fillReplace,
  fillSearch,
  getEditorContent,
  getSearchInput,
  getSearchPanelHost,
  getSearchPanelRoot,
  getSearchState,
  makeSearchScrollContents,
  replaceFromPanel,
} from './codeViewSearchHarness';
import {
  createRoot,
  installDom,
  renderItems,
  setPrefersReducedMotion,
  wait,
  waitFor,
} from './domHarness';

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

describe('CodeView search API', () => {
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
      expect(panelRoot.querySelector('input[data-replace]')).not.toBeNull();
      expect(
        panelRoot.querySelector<HTMLButtonElement>('[data-replace-toggle]')!
          .hidden
      ).toBe(true);
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

  test('leaves the find shortcut to the host while shortcuts are disabled', async () => {
    const dom = installDom();
    const createEditor: CodeViewOptions<
      undefined,
      undefined
    >['createEditor'] = (type, options, key) => new Editor(type, options, key);
    const viewer = new CodeView({
      createEditor,
      searchOptions: { disableShortcuts: true },
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
      ]);
      const content = getEditorContent(viewer, 'a');
      const itemRoot = viewer.getRenderedItems()[0].element.shadowRoot!;

      // Neither CodeView nor the editor it created answers the find keys, so
      // a window-level binding (or the browser) gets them.
      content.focus();
      for (const altKey of [false, true]) {
        const event = dispatchPrimaryFind(content, altKey);
        await wait(0);
        expect(event.defaultPrevented).toBe(false);
        expect(root.querySelector('[data-search-panel]')).toBeNull();
        expect(itemRoot.querySelector('[data-search-panel]')).toBeNull();
      }
      root.focus();
      expect(dispatchPrimaryFind(root).defaultPrevented).toBe(false);
      expect(root.querySelector('[data-search-panel]')).toBeNull();

      // The binding follows setOptions without a re-render.
      viewer.setOptions({
        createEditor,
        searchOptions: { disableShortcuts: false },
      });
      expect(dispatchPrimaryFind(root).defaultPrevented).toBe(true);
      await wait(0);
      fillSearch(root, 'target');
      expect(getSearchState(viewer).matches).toHaveLength(2);

      // Disabling again only drops the open shortcut: find-again and Escape
      // still drive the open panel.
      viewer.setOptions({
        createEditor,
        searchOptions: { disableShortcuts: true },
      });
      expect(dispatchFindAgain(root).defaultPrevented).toBe(true);
      expect(getSearchState(viewer).current?.startCharacter).toBe(7);
      expect(dispatchEscape(root).defaultPrevented).toBe(true);
      expect(root.querySelector('[data-search-panel]')).toBeNull();
      expect(dispatchPrimaryFind(root).defaultPrevented).toBe(false);
      expect(root.querySelector('[data-search-panel]')).toBeNull();
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('opens, scopes, navigates, and closes search programmatically', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
    });
    try {
      const root = createRoot();
      root.tabIndex = 0;
      // Before setup there is nowhere to mount a panel.
      viewer.openSearch({ query: 'target' });
      expect(viewer.isSearchOpen()).toBe(false);
      viewer.setup(root);
      expect(viewer.isSearchOpen()).toBe(false);
      viewer.navigateSearch('next');
      await renderItems(viewer, [
        {
          id: 'a',
          type: 'file',
          edit: true,
          file: { name: 'a.txt', contents: 'target target' },
        },
        {
          id: 'read',
          type: 'file',
          file: { name: 'read.txt', contents: 'target read' },
        },
      ]);

      // Nothing focused: the default scope is every item, so the replace
      // request is ignored and the seeded query searches on open. Navigation
      // right after opening steps from that query's results.
      viewer.openSearch({ query: 'target' });
      viewer.navigateSearch('next');
      expect(viewer.isSearchOpen()).toBe(true);
      const input = getSearchInput(root);
      const grid =
        getSearchPanelRoot(root).querySelector<HTMLElement>(
          '[data-search-grid]'
        )!;
      expect(getSearchPanelRoot(root).activeElement).toBe(input);
      expect(input.value).toBe('target');
      expect(grid.dataset.mode).toBe('find');
      expect(getSearchState(viewer).scope).toBeUndefined();
      expect(getSearchState(viewer).matches).toHaveLength(3);
      expect(getSearchState(viewer).current).toMatchObject({
        itemId: 'a',
        startCharacter: 7,
      });

      viewer.navigateSearch('previous');
      expect(getSearchState(viewer).current).toMatchObject({
        itemId: 'a',
        startCharacter: 0,
      });
      viewer.navigateSearch('previous');
      expect(getSearchState(viewer).current).toMatchObject({
        itemId: 'read',
      });

      // An explicit item scope sticks only for an expanded edit-mode item,
      // and navigation right after a scope change steps through that scope.
      viewer.openSearch({ scope: { itemId: 'a' } });
      viewer.navigateSearch('next');
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'a' });
      expect(getSearchState(viewer).matches).toHaveLength(2);
      expect(getSearchState(viewer).current).toMatchObject({ itemId: 'a' });
      expect(grid.dataset.mode).toBe('replace');
      viewer.openSearch({ scope: { itemId: 'read' } });
      expect(getSearchState(viewer).scope).toBeUndefined();
      expect(grid.dataset.mode).toBe('find');
      viewer.openSearch({ scope: { itemId: 'missing' } });
      expect(getSearchState(viewer).scope).toBeUndefined();

      // The default scope follows the focused editor, and the panel keeps it
      // once focus moves into the panel.
      getEditorContent(viewer, 'a').focus();
      viewer.openSearch({ mode: 'find' });
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'a' });
      expect(grid.dataset.mode).toBe('find');
      expect(getSearchPanelRoot(root).activeElement).toBe(input);
      viewer.openSearch({ query: 'read' });
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'a' });
      expect(input.value).toBe('read');
      expect(getSearchState(viewer).matches).toHaveLength(0);
      viewer.openSearch({ scope: 'all' });
      await wait(0);
      expect(getSearchState(viewer).scope).toBeUndefined();
      expect(getSearchState(viewer).matches).toHaveLength(1);
      expect(getSearchState(viewer).matches[0]).toMatchObject({
        itemId: 'read',
      });

      viewer.closeSearch();
      expect(viewer.isSearchOpen()).toBe(false);
      expect(root.querySelector('[data-search-panel]')).toBeNull();
      expect(getSearchState(viewer).matches).toHaveLength(0);
      viewer.navigateSearch('next');
      viewer.closeSearch();
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('rebinds replace when a scoped offscreen edit item mounts', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
    });
    try {
      const root = createRoot();
      viewer.setup(root);
      const filler = Array.from({ length: 400 }, (_, i) => `line ${i}`).join(
        '\n'
      );
      await renderItems(viewer, [
        {
          id: 'top',
          type: 'file',
          file: { name: 'top.txt', contents: filler },
        },
        {
          id: 'far',
          type: 'file',
          edit: true,
          file: { name: 'far.txt', contents: 'target far' },
        },
      ]);
      expect(viewer.getEditor('far')).toBeUndefined();

      viewer.openSearch({ scope: { itemId: 'far' }, query: 'target' });
      await wait(0);
      const grid =
        getSearchPanelRoot(root).querySelector<HTMLElement>(
          '[data-search-grid]'
        )!;
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'far' });
      expect(getSearchState(viewer).matches).toHaveLength(1);
      expect(grid.dataset.mode).toBe('find');

      viewer.scrollTo({ type: 'item', id: 'far', behavior: 'instant' });
      await waitFor(() => viewer.getEditor('far') != null);
      await waitFor(() => grid.dataset.mode === 'replace');
      expect(getSearchState(viewer).scope).toEqual({ itemId: 'far' });
      expect(getSearchState(viewer).matches).toHaveLength(1);
      fillReplace(root, 'done');
      replaceFromPanel(root);
      expect(viewer.getEditor('far')?.getEditState()?.document.getText()).toBe(
        'done far'
      );
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('reports search state on open, every change, and close', async () => {
    const dom = installDom();
    const states: (SearchPanelState | undefined)[] = [];
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
      onSearchStateChange: (state) => states.push(state),
    });
    const last = () => states.at(-1);
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
          id: 'read',
          type: 'file',
          file: { name: 'read.txt', contents: 'target read' },
        },
      ]);

      viewer.openSearch({ query: 'target' });
      expect(last()).toMatchObject({
        text: 'target',
        matchCount: 0,
        canReplace: false,
        mode: 'find',
      });
      await wait(0);
      expect(last()).toMatchObject({ matchCount: 3, currentMatchIndex: 0 });

      viewer.navigateSearch('next');
      expect(last()).toMatchObject({ currentMatchIndex: 1 });

      fillSearch(root, 'tar');
      expect(last()).toMatchObject({ text: 'tar', matchCount: 3 });
      fillReplace(root, 'x');
      expect(last()).toMatchObject({ replaceText: 'x' });
      getSearchPanelRoot(root)
        .querySelector<HTMLButtonElement>('button[title="Match Case"]')!
        .click();
      expect(last()).toMatchObject({ caseSensitive: true });

      // A scope change reports nothing until its matches are refreshed, so
      // no snapshot pairs the new scope with the old counts.
      const beforeScope = states.length;
      getEditorContent(viewer, 'a').focus();
      viewer.openSearch();
      expect(states.length).toBe(beforeScope);
      await wait(0);
      expect(states.length).toBeGreaterThan(beforeScope);
      for (const state of states.slice(beforeScope)) {
        expect(state).toMatchObject({
          canReplace: true,
          mode: 'replace',
          matchCount: 2,
        });
      }

      viewer.closeSearch();
      expect(last()).toBeUndefined();
      expect(states.filter((state) => state == null)).toHaveLength(1);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('survives closing from inside the state callback', async () => {
    const dom = installDom();
    const states: (SearchPanelState | undefined)[] = [];
    const viewer = new CodeView({
      onSearchStateChange: (state) => {
        states.push(state);
        if (state?.text === 'close me') {
          viewer.closeSearch();
        }
      },
    });
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        { id: 'a', type: 'file', file: { name: 'a.txt', contents: 'target' } },
      ]);

      // Closing from the opening emission leaves nothing behind.
      viewer.openSearch({ query: 'close me' });
      expect(viewer.isSearchOpen()).toBe(false);
      expect(root.querySelector('[data-search-panel]')).toBeNull();
      expect(states.at(-1)).toBeUndefined();

      // Closing from a query change on an open panel does not throw, and no
      // state is reported after the close.
      viewer.openSearch({ query: 'target' });
      expect(viewer.isSearchOpen()).toBe(true);
      viewer.openSearch({ query: 'close me' });
      expect(viewer.isSearchOpen()).toBe(false);
      expect(root.querySelector('[data-search-panel]')).toBeNull();
      expect(states.at(-1)).toBeUndefined();
      await wait(0);
      expect(states.at(-1)).toBeUndefined();
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('applies matching defaults to a fresh panel only', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      searchOptions: { defaults: { caseSensitive: true, regex: true } },
    });
    const caseToggle = () =>
      getSearchPanelRoot(root).querySelector<HTMLButtonElement>(
        'button[title="Match Case"]'
      )!;
    const root = createRoot();
    try {
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'a',
          type: 'file',
          file: { name: 'a.txt', contents: 'target Target t.rget' },
        },
      ]);

      viewer.openSearch({ query: 't.rget' });
      await wait(0);
      expect(caseToggle().ariaPressed).toBe('true');
      expect(getSearchState(viewer).matches).toHaveLength(2);

      // The user's own toggles survive reopening the live panel.
      caseToggle().click();
      expect(getSearchState(viewer).matches).toHaveLength(3);
      viewer.openSearch();
      expect(caseToggle().ariaPressed).toBe('false');
      expect(getSearchState(viewer).matches).toHaveLength(3);

      // A fresh panel starts from the defaults again.
      viewer.closeSearch();
      viewer.openSearch({ query: 't.rget' });
      await wait(0);
      expect(caseToggle().ariaPressed).toBe('true');
      expect(getSearchState(viewer).matches).toHaveLength(2);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('seeds the query from the scoped editor selection', async () => {
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
          id: 'a',
          type: 'file',
          edit: true,
          file: { name: 'a.txt', contents: 'alpha beta\ngamma' },
        },
      ]);
      const content = getEditorContent(viewer, 'a');
      const editor = viewer.getEditor('a')!;
      const select = (
        start: { line: number; character: number },
        end: { line: number; character: number }
      ) => {
        content.focus();
        editor.setSelections([{ start, end, direction: 'forward' }]);
      };

      // A collapsed caret opens on the word under it.
      select({ line: 0, character: 7 }, { line: 0, character: 7 });
      viewer.openSearch();
      await wait(0);
      expect(getSearchInput(root).value).toBe('beta');
      expect(getSearchState(viewer).matches).toHaveLength(1);
      // Reopening keeps the panel's query.
      select({ line: 0, character: 1 }, { line: 0, character: 1 });
      viewer.openSearch();
      expect(getSearchInput(root).value).toBe('beta');
      viewer.closeSearch();

      // A single-line selection opens on its text; a multi-line one opens empty.
      select({ line: 0, character: 0 }, { line: 0, character: 3 });
      viewer.openSearch();
      expect(getSearchInput(root).value).toBe('alp');
      viewer.closeSearch();
      select({ line: 0, character: 6 }, { line: 1, character: 2 });
      viewer.openSearch();
      expect(getSearchInput(root).value).toBe('');
      viewer.closeSearch();

      // Searching every item opens empty regardless of the selection.
      select({ line: 0, character: 7 }, { line: 0, character: 7 });
      viewer.openSearch({ scope: 'all' });
      expect(getSearchInput(root).value).toBe('');
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  // The panel's own stylesheet is an inlined CSS import that bun's test loader
  // does not expose as text, so its layering is covered by the e2e suites.
  test('opens when the highlight properties are already registered', () => {
    const dom = installDom();
    const { registerProperty } = window.CSS;
    // A second copy of the library, or a hot reload, finds the document's
    // properties registered already and the browser refuses to re-register.
    window.CSS.registerProperty = () => {
      throw new DOMException('already registered', 'InvalidModificationError');
    };
    const viewer = new CodeView();
    try {
      const root = createRoot();
      viewer.setup(root);
      viewer.openSearch({ query: 'target' });
      expect(viewer.isSearchOpen()).toBe(true);
      expect(root.querySelector('[data-search-panel]')).not.toBeNull();
    } finally {
      window.CSS.registerProperty = registerProperty;
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('applies the host unsafeCSS inside the panel after its own styles', () => {
    const dom = installDom();
    const unsafeCSS = 'input[data-search] { color: rgb(1, 2, 3); }';
    const viewer = new CodeView({ unsafeCSS });
    try {
      const root = createRoot();
      viewer.setup(root);
      viewer.openSearch();
      const styles = Array.from(
        getSearchPanelRoot(root).querySelectorAll('style')
      );
      expect(styles).toHaveLength(2);
      expect(styles[0].hasAttribute('data-unsafe-css')).toBe(false);
      expect(styles[1].hasAttribute('data-unsafe-css')).toBe(true);
      expect(styles[1].textContent).toContain('@layer unsafe {');
      expect(styles[1].textContent).toContain(unsafeCSS);
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('scrolls to matches with the configured behavior', async () => {
    const dom = installDom();
    const viewer = new CodeView({
      searchOptions: { scrollBehavior: 'smooth' },
    });
    const getScrollAnimation = () =>
      (viewer as unknown as { scrollAnimation: unknown }).scrollAnimation;
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        {
          id: 'file-a',
          type: 'file',
          file: { name: 'file-a.ts', contents: makeSearchScrollContents() },
        },
      ]);
      viewer.openSearch({ query: 'target' });
      viewer.navigateSearch('next');
      expect(getSearchState(viewer).current?.lineNumber).toBe(500);
      expect(getScrollAnimation()).toBeDefined();

      // The option applies live through setOptions.
      viewer.setOptions({ searchOptions: { scrollBehavior: 'instant' } });
      viewer.navigateSearch('previous');
      expect(getSearchState(viewer).current?.lineNumber).toBe(1);
      expect(getScrollAnimation()).toBeUndefined();
      viewer.render(true);
      expect(root.scrollTop).toBe(0);
      viewer.navigateSearch('next');
      expect(getScrollAnimation()).toBeUndefined();
      viewer.render(true);
      expect(root.scrollTop).toBeGreaterThan(0);

      // A reduced-motion preference overrides a smooth request.
      viewer.setOptions({ searchOptions: { scrollBehavior: 'smooth' } });
      setPrefersReducedMotion(true);
      viewer.navigateSearch('previous');
      expect(getSearchState(viewer).current?.lineNumber).toBe(1);
      expect(getScrollAnimation()).toBeUndefined();
    } finally {
      setPrefersReducedMotion(false);
      viewer.cleanUp();
      dom.cleanup();
    }
  });
});
