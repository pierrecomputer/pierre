import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

function installDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    CSSStyleSheet: Reflect.get(globalThis, 'CSSStyleSheet'),
    customElements: Reflect.get(globalThis, 'customElements'),
    document: Reflect.get(globalThis, 'document'),
    Event: Reflect.get(globalThis, 'Event'),
    HTMLButtonElement: Reflect.get(globalThis, 'HTMLButtonElement'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLInputElement: Reflect.get(globalThis, 'HTMLInputElement'),
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    HTMLTemplateElement: Reflect.get(globalThis, 'HTMLTemplateElement'),
    MutationObserver: Reflect.get(globalThis, 'MutationObserver'),
    navigator: Reflect.get(globalThis, 'navigator'),
    Node: Reflect.get(globalThis, 'Node'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    ShadowRoot: Reflect.get(globalThis, 'ShadowRoot'),
    window: Reflect.get(globalThis, 'window'),
  };

  class MockStyleSheet {
    replaceSync(_value: string): void {}
  }

  class MockResizeObserver {
    observe(_target: Element): void {}
    disconnect(): void {}
  }

  Object.assign(globalThis, {
    CSSStyleSheet: MockStyleSheet,
    customElements: dom.window.customElements,
    document: dom.window.document,
    Event: dom.window.Event,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    HTMLTemplateElement: dom.window.HTMLTemplateElement,
    MutationObserver: dom.window.MutationObserver,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    ResizeObserver: MockResizeObserver,
    SVGElement: dom.window.SVGElement,
    ShadowRoot: dom.window.ShadowRoot,
    window: dom.window,
  });

  return {
    cleanup() {
      for (const [key, value] of Object.entries(originalValues)) {
        if (value === undefined) {
          Reflect.deleteProperty(globalThis, key);
        } else {
          Object.assign(globalThis, { [key]: value });
        }
      }
      dom.window.close();
    },
    dom,
  };
}

async function flushDom(times: number = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function pressKey(
  target: Element,
  dom: JSDOM,
  key: string,
  init: KeyboardEventInit = {}
): void {
  target.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      ...init,
    })
  );
}

function setInputValue(
  input: HTMLInputElement,
  dom: JSDOM,
  value: string
): void {
  input.value = value;
  input.dispatchEvent(
    new dom.window.Event('input', {
      bubbles: true,
      cancelable: true,
    })
  );
}

function getShadowRoot(fileTree: import('../src/index').FileTree): ShadowRoot {
  const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
  if (!(shadowRoot instanceof ShadowRoot)) {
    throw new Error('Expected file tree shadow root');
  }

  return shadowRoot;
}

const CANONICAL_ITEM_SELECTOR =
  '[data-type="item"]:not([data-file-tree-sticky-row="true"])';

function getItemRow(
  shadowRoot: ShadowRoot,
  dom: JSDOM,
  path: string
): HTMLElement {
  const row = shadowRoot.querySelector(
    `${CANONICAL_ITEM_SELECTOR}[data-item-path="${path}"]`
  );
  if (!(row instanceof dom.window.HTMLElement)) {
    throw new Error(`Expected canonical item row for ${path}`);
  }

  return row;
}

function getItemButton(
  shadowRoot: ShadowRoot,
  dom: JSDOM,
  path: string
): HTMLButtonElement {
  const button = getItemRow(shadowRoot, dom, path);
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`Expected item button for ${path}`);
  }

  return button;
}

function getStickyRowButton(
  shadowRoot: ShadowRoot,
  dom: JSDOM,
  path: string
): HTMLButtonElement {
  const button = shadowRoot.querySelector(
    `[data-file-tree-sticky-path="${path}"]`
  );
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`Expected sticky row for ${path}`);
  }

  return button;
}

function getScrollElement(shadowRoot: ShadowRoot, dom: JSDOM): HTMLElement {
  const scrollElement = shadowRoot.querySelector(
    '[data-file-tree-virtualized-scroll="true"]'
  );
  if (!(scrollElement instanceof dom.window.HTMLElement)) {
    throw new Error('Expected virtualized scroll element');
  }

  return scrollElement;
}

function getRenameInput(
  shadowRoot: ShadowRoot,
  dom: JSDOM,
  flattened: boolean = false
): HTMLInputElement {
  const selector = flattened
    ? '[data-item-flattened-rename-input]'
    : '[data-item-rename-input]';
  const input = shadowRoot.querySelector(selector);
  if (!(input instanceof dom.window.HTMLInputElement)) {
    throw new Error(`Expected rename input for selector ${selector}`);
  }

  return input;
}

function getSearchInput(shadowRoot: ShadowRoot, dom: JSDOM): HTMLInputElement {
  const input = shadowRoot.querySelector('input[data-file-tree-search-input]');
  if (!(input instanceof dom.window.HTMLInputElement)) {
    throw new Error('Expected built-in search input');
  }

  return input;
}

async function loadFileTree(): Promise<typeof import('../src/index').FileTree> {
  const module = await import('../src/render/FileTree');
  const fileTree = Object.values(module).find(
    (value): value is typeof import('../src/index').FileTree =>
      typeof value === 'function' &&
      'prototype' in value &&
      'render' in value.prototype
  );
  if (fileTree == null) {
    throw new Error('Expected FileTree export');
  }

  return fileTree;
}

describe('file-tree renaming', () => {
  test('F2 starts inline rename and Enter commits while preserving focus and selection', async () => {
    const { cleanup, dom } = installDom();
    try {
      const renameEvents: Array<{
        destinationPath: string;
        isFolder: boolean;
        sourcePath: string;
      }> = [];
      const FileTree = await loadFileTree();

      const fileTree = new FileTree({
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 240 / 30,
        renaming: {
          onRename: (event) => {
            renameEvents.push(event);
          },
        },
      });
      const containerWrapper = document.createElement('div');
      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = getShadowRoot(fileTree);
      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');
      readmeButton.click();
      readmeButton.focus();
      await flushDom();

      pressKey(readmeButton, dom, 'F2');
      await flushDom();

      const renameInput = getRenameInput(shadowRoot, dom);
      expect(renameInput.value).toBe('README.md');

      setInputValue(renameInput, dom, 'RENAMED.md');
      pressKey(renameInput, dom, 'Enter');
      await flushDom(3);

      expect(renameEvents).toEqual([
        {
          destinationPath: 'RENAMED.md',
          isFolder: false,
          sourcePath: 'README.md',
        },
      ]);
      expect(fileTree.getItem('RENAMED.md')).not.toBeNull();

      const renamedButton = getItemButton(shadowRoot, dom, 'RENAMED.md');
      expect(renamedButton.dataset.itemSelected).toBe('true');
    } finally {
      cleanup();
    }
  });

  test('Escape cancels inline rename and blur commits it', async () => {
    const { cleanup, dom } = installDom();
    try {
      const renameEvents: Array<string> = [];
      const FileTree = await loadFileTree();

      const fileTree = new FileTree({
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 240 / 30,
        renaming: {
          onRename: (event) => {
            renameEvents.push(`${event.sourcePath}->${event.destinationPath}`);
          },
        },
      });
      const containerWrapper = document.createElement('div');
      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = getShadowRoot(fileTree);
      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');
      readmeButton.click();
      readmeButton.focus();
      await flushDom();
      pressKey(readmeButton, dom, 'F2');
      await flushDom();

      const escapeInput = getRenameInput(shadowRoot, dom);
      pressKey(escapeInput, dom, 'Escape');
      await flushDom();
      expect(shadowRoot.querySelector('[data-item-rename-input]')).toBeNull();
      expect(renameEvents).toEqual([]);

      const readmeButtonAfterEscape = getItemButton(
        shadowRoot,
        dom,
        'README.md'
      );
      pressKey(readmeButtonAfterEscape, dom, 'F2');
      await flushDom();
      const blurInput = getRenameInput(shadowRoot, dom);
      setInputValue(blurInput, dom, 'README-BLUR.md');
      blurInput.dispatchEvent(new dom.window.FocusEvent('blur'));
      await flushDom();

      expect(shadowRoot.querySelector('[data-item-rename-input]')).toBeNull();
      expect(renameEvents).toEqual(['README.md->README-BLUR.md']);
      expect(fileTree.getItem('README-BLUR.md')).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  test('search-open rename handoff closes search and keeps the focused result anchored', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const searchChanges: Array<string | null> = [];

      const fileTree = new FileTree({
        fileTreeSearchMode: 'hide-non-matches',
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        onSearchChange: (value) => {
          searchChanges.push(value);
        },
        paths: [
          'README.md',
          'src/index.ts',
          'src/utils/worker.ts',
          'src/utils/stream.ts',
        ],
        renaming: true,
        search: true,
        initialVisibleRowCount: 240 / 30,
      });
      const containerWrapper = document.createElement('div');
      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = getShadowRoot(fileTree);
      const firstRow = getItemButton(shadowRoot, dom, 'README.md');
      firstRow.click();
      firstRow.focus();
      await flushDom();
      pressKey(firstRow, dom, 'w');
      await flushDom();

      const searchInput = getSearchInput(shadowRoot, dom);

      setInputValue(searchInput, dom, 'worker');
      await flushDom();
      expect(
        shadowRoot.querySelector('[data-item-path="README.md"]')
      ).toBeNull();
      expect(fileTree.getSelectedPaths()).toEqual(['README.md']);

      pressKey(searchInput, dom, 'F2');
      await flushDom(3);

      const renameInput = getRenameInput(shadowRoot, dom);
      expect(renameInput.value).toBe('worker.ts');
      expect(searchInput.value).toBe('');
      expect(getItemButton(shadowRoot, dom, 'README.md')).toBeDefined();
      expect(fileTree.getSelectedPaths()).toEqual(['src/utils/worker.ts']);
      expect(searchChanges).toEqual(['w', 'worker', null]);
    } finally {
      cleanup();
    }
  });

  test('context-menu rename closes the menu and focuses the inline input without blur-cancel churn', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      let fileTree: import('../src/index').FileTree;

      fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (item, context) => {
              const menu = document.createElement('div');
              menu.setAttribute('data-test-context-menu', 'true');
              const renameButton = document.createElement('button');
              renameButton.type = 'button';
              renameButton.textContent = 'Rename';
              renameButton.setAttribute('data-test-menu-rename', item.path);
              renameButton.addEventListener('click', () => {
                context.close({ restoreFocus: false });
                fileTree.startRenaming(item.path);
                queueMicrotask(() => {
                  context.close();
                  context.restoreFocus();
                });
              });
              menu.append(renameButton);
              return menu;
            },
          },
        },
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 240 / 30,
        renaming: true,
      });
      const containerWrapper = document.createElement('div');
      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = getShadowRoot(fileTree);
      const indexButton = getItemButton(shadowRoot, dom, 'src/index.ts');
      indexButton.click();
      await flushDom();
      indexButton.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
        })
      );
      await flushDom(3);

      const menuButton = fileTree
        .getFileTreeContainer()
        ?.querySelector(
          '[data-test-menu-rename="src/index.ts"]'
        ) as HTMLButtonElement | null;
      if (!(menuButton instanceof dom.window.HTMLButtonElement)) {
        throw new Error('Expected context-menu rename button');
      }

      const confirmedMenuButton = menuButton;
      confirmedMenuButton.click();
      await flushDom(4);

      expect(
        fileTree
          .getFileTreeContainer()
          ?.querySelector('[data-test-context-menu="true"]')
      ).toBeNull();
      const renameInput = getRenameInput(shadowRoot, dom);
      expect(renameInput.value).toBe('index.ts');
    } finally {
      cleanup();
    }
  });

  test('sticky-row rename handoff reveals the canonical row input and focuses it', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['aaa/', 'bbb/', 'src/lib/'],
        paths: ['aaa/one.ts', 'bbb/two.ts', 'src/index.ts', 'src/lib/util.ts'],
        stickyFolders: true,
        initialVisibleRowCount: 60 / 30,
        renaming: true,
      });
      const containerWrapper = document.createElement('div');
      document.body.append(containerWrapper);
      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = getShadowRoot(fileTree);
      const scrollElement = getScrollElement(shadowRoot, dom);

      const utilButton = getItemButton(shadowRoot, dom, 'src/lib/util.ts');
      utilButton.click();
      utilButton.focus();
      await flushDom();
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/util.ts']);

      scrollElement.scrollTop = 149;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      const stickyButton = getStickyRowButton(shadowRoot, dom, 'src/lib/');
      expect(stickyButton.dataset.fileTreeStickyPath).toBe('src/lib/');
      expect(() => getItemButton(shadowRoot, dom, 'src/lib/')).toThrow();

      expect(fileTree.startRenaming('src/lib/')).toBe(true);
      await flushDom(4);
      expect(scrollElement.scrollTop).toBeLessThan(149);
      const renameInput = getRenameInput(shadowRoot, dom);
      const renameRow = getItemRow(shadowRoot, dom, 'src/lib/');
      expect(renameInput.value).toBe('lib');
      expect(renameRow.querySelector('[data-item-rename-input]')).toBe(
        renameInput
      );
      expect(renameRow.getAttribute('data-file-tree-sticky-row')).toBeNull();
      expect(shadowRoot.activeElement).toBe(renameInput);
      expect(renameInput.selectionStart).toBe(0);
      expect(renameInput.selectionEnd).toBe('lib'.length);
      expect(fileTree.getFocusedPath()).toBe('src/lib/');
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/']);
    } finally {
      cleanup();
    }
  });

  test('flattened leaf rename renders input only on the terminal segment and commits a folder rename', async () => {
    const { cleanup, dom } = installDom();
    try {
      const renameEvents: Array<{
        destinationPath: string;
        isFolder: boolean;
        sourcePath: string;
      }> = [];
      const FileTree = await loadFileTree();

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['src/utils/deep/index.ts'],
        initialVisibleRowCount: 240 / 30,
        renaming: {
          onRename: (event) => {
            renameEvents.push(event);
          },
        },
      });
      const containerWrapper = document.createElement('div');
      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = getShadowRoot(fileTree);
      const flattenedButton = Array.from(
        shadowRoot.querySelectorAll(
          'button[data-type="item"][data-item-type="folder"]'
        )
      ).find(
        (button) =>
          button instanceof dom.window.HTMLButtonElement &&
          button.querySelector('[data-item-flattened-subitems]') != null
      ) as HTMLButtonElement | undefined;
      if (flattenedButton == null) {
        throw new Error('Expected flattened folder row');
      }

      flattenedButton.click();
      flattenedButton.focus();
      pressKey(flattenedButton, dom, 'F2');
      await flushDom(3);

      const renameInput = getRenameInput(shadowRoot, dom, true);
      expect(renameInput.value).toBe('deep');
      const flattenedContainer = renameInput.closest(
        '[data-item-flattened-subitems]'
      );
      if (flattenedContainer == null) {
        throw new Error('Expected flattened segments container');
      }

      const segments = flattenedContainer.querySelectorAll(
        '[data-item-flattened-subitem]'
      );
      expect(segments.length).toBeGreaterThan(1);
      expect(
        segments.item(0)?.querySelector('[data-item-rename-input]')
      ).toBeNull();
      expect(
        segments
          .item(segments.length - 1)
          ?.querySelector('[data-item-rename-input]')
      ).toBe(renameInput);

      setInputValue(renameInput, dom, 'renamed');
      pressKey(renameInput, dom, 'Enter');
      await flushDom(3);

      expect(renameEvents).toEqual([
        {
          destinationPath: 'src/utils/renamed',
          isFolder: true,
          sourcePath: 'src/utils/deep',
        },
      ]);
      expect(fileTree.getItem('src/utils/renamed')).not.toBeNull();
      expect(fileTree.getItem('src/utils/deep')).toBeNull();
    } finally {
      cleanup();
    }
  });

  test('collision and invalid-name errors close rename and surface parity errors', async () => {
    const { cleanup, dom } = installDom();
    try {
      const renameErrors: string[] = [];
      const FileTree = await loadFileTree();

      const fileTree = new FileTree({
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts', 'src/utils.ts'],
        initialVisibleRowCount: 240 / 30,
        renaming: {
          onError: (error) => {
            renameErrors.push(error);
          },
        },
      });
      const containerWrapper = document.createElement('div');
      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = getShadowRoot(fileTree);
      const indexButton = getItemButton(shadowRoot, dom, 'src/index.ts');
      indexButton.click();
      indexButton.focus();
      await flushDom();
      pressKey(indexButton, dom, 'F2');
      await flushDom();

      const collisionInput = getRenameInput(shadowRoot, dom);
      setInputValue(collisionInput, dom, 'utils.ts');
      pressKey(collisionInput, dom, 'Enter');
      await flushDom();

      const indexButtonAfterCollision = getItemButton(
        shadowRoot,
        dom,
        'src/index.ts'
      );
      pressKey(indexButtonAfterCollision, dom, 'F2');
      await flushDom();
      const invalidInput = getRenameInput(shadowRoot, dom);
      setInputValue(invalidInput, dom, 'nested/name.ts');
      pressKey(invalidInput, dom, 'Enter');
      await flushDom();

      expect(renameErrors).toEqual([
        '"src/utils.ts" already exists.',
        'Name cannot include "/".',
      ]);
      expect(shadowRoot.querySelector('[data-item-rename-input]')).toBeNull();
      expect(fileTree.getItem('src/index.ts')).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});
