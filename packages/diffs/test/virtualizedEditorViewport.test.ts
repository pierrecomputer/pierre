import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import type { DiffsEditableComponent } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom } from './domHarness';

interface EditorViewState {
  scrollLeft?: number;
  scrollTop?: number;
}

interface EditorViewStateOperations {
  captureEditorViewState(): EditorViewState | undefined;
  restoreEditorViewState(view: EditorViewState): void;
}

function viewStateOperations(
  component: DiffsEditableComponent<undefined>
): EditorViewStateOperations {
  return component as DiffsEditableComponent<undefined> &
    EditorViewStateOperations;
}

function createSimpleVirtualizer(root: HTMLElement, scrollTop: number) {
  const virtualizer = {
    type: 'simple',
    config: {},
    connect() {},
    disconnect() {},
    getRoot: () => root,
    getScrollTop: () => scrollTop,
    getWindowSpecs: () => ({ top: 0, bottom: 800 }),
    getOffsetInScrollContainer: () => 0,
    instanceChanged() {},
    isInstanceVisible: () => true,
    markDOMDirty() {},
    requestHeightReconcile() {},
  } as never;
  return virtualizer;
}

function createAdvancedVirtualizer(root: HTMLElement, scrollTop: number) {
  const scrollCalls: unknown[] = [];
  const codeView = {
    type: 'advanced',
    getContainerElement: () => root,
    getScrollTop: () => scrollTop,
    scrollTo(target: unknown) {
      scrollCalls.push(target);
    },
  } as never;
  return { codeView, scrollCalls };
}

function renderFile(
  file: VirtualizedFile<undefined>,
  root: HTMLElement
): HTMLElement {
  const fileContainer = document.createElement('div');
  root.appendChild(fileContainer);
  file.render({
    file: { name: 'state.ts', contents: 'alpha\nbravo\n' },
    fileContainer,
    forceRender: true,
  });
  const code = fileContainer.shadowRoot?.querySelector('[data-code]');
  expect(code).toBeInstanceOf(HTMLElement);
  return code as HTMLElement;
}

function renderFileDiff(
  fileDiff: VirtualizedFileDiff<undefined>,
  root: HTMLElement
): { additions: HTMLElement; deletions?: HTMLElement } {
  const fileContainer = document.createElement('div');
  root.appendChild(fileContainer);
  fileDiff.render({
    fileDiff: parseDiffFromFile(
      { name: 'state.ts', contents: 'alpha\nbravo\n' },
      { name: 'state.ts', contents: 'alpha\ncharlie\n' }
    ),
    fileContainer,
    forceRender: true,
  });
  const additions = fileContainer.shadowRoot?.querySelector(
    '[data-code]:not([data-deletions])'
  );
  const deletions = fileContainer.shadowRoot?.querySelector(
    '[data-code][data-deletions]'
  );
  expect(additions).toBeInstanceOf(HTMLElement);
  return {
    additions: additions as HTMLElement,
    deletions: deletions instanceof HTMLElement ? deletions : undefined,
  };
}

describe('virtualized editor viewport', () => {
  test('uses the simple Virtualizer root', () => {
    const dom = installDom();
    const root = document.createElement('div');
    const virtualizer = {
      type: 'simple',
      getRoot: () => root,
    } as never;
    const file = new VirtualizedFile({}, virtualizer);
    const fileDiff = new VirtualizedFileDiff({}, virtualizer);

    try {
      expect(file.getEditorViewport()).toBe(root);
      expect(fileDiff.getEditorViewport()).toBe(root);
    } finally {
      file.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });

  test('uses the advanced CodeView container', () => {
    const dom = installDom();
    const root = document.createElement('div');
    const codeView = {
      type: 'advanced',
      getContainerElement: () => root,
    } as never;
    const file = new VirtualizedFile({}, codeView);
    const fileDiff = new VirtualizedFileDiff({}, codeView);

    try {
      expect(file.getEditorViewport()).toBe(root);
      expect(fileDiff.getEditorViewport()).toBe(root);
    } finally {
      file.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });

  test('captures File horizontal state and simple Virtualizer vertical state', () => {
    const dom = installDom();
    const root = document.createElement('div');
    root.scrollLeft = 900;
    root.scrollTop = 800;
    const virtualizer = createSimpleVirtualizer(root, 700);
    const file = new VirtualizedFile(
      { disableFileHeader: true, theme: DEFAULT_THEMES },
      virtualizer
    );

    try {
      const code = renderFile(file, root);
      code.scrollLeft = 60;

      expect(viewStateOperations(file).captureEditorViewState()).toEqual({
        scrollLeft: 60,
        scrollTop: 700,
      });
      expect(file.getEditorViewport()).toBe(root);
    } finally {
      file.cleanUp();
      dom.cleanup();
    }
  });

  for (const diffStyle of ['unified', 'split'] as const) {
    test(`captures ${diffStyle} FileDiff state from the additions code column`, () => {
      const dom = installDom();
      const root = document.createElement('div');
      root.scrollLeft = 900;
      root.scrollTop = 800;
      const virtualizer = createSimpleVirtualizer(root, 700);
      const fileDiff = new VirtualizedFileDiff(
        {
          diffStyle,
          disableFileHeader: true,
          theme: DEFAULT_THEMES,
        },
        virtualizer
      );

      try {
        const code = renderFileDiff(fileDiff, root);
        code.additions.scrollLeft = 60;
        if (code.deletions !== undefined) {
          code.deletions.scrollLeft = 40;
        }

        expect(viewStateOperations(fileDiff).captureEditorViewState()).toEqual({
          scrollLeft: 60,
          scrollTop: 700,
        });
        expect(fileDiff.getEditorViewport()).toBe(root);
      } finally {
        fileDiff.cleanUp();
        dom.cleanup();
      }
    });
  }

  test('restores split FileDiff horizontal state to both code columns', () => {
    const dom = installDom();
    const root = document.createElement('div');
    const virtualizer = createSimpleVirtualizer(root, 0);
    const fileDiff = new VirtualizedFileDiff(
      {
        diffStyle: 'split',
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
      },
      virtualizer
    );

    try {
      const code = renderFileDiff(fileDiff, root);
      expect(code.deletions).toBeDefined();

      viewStateOperations(fileDiff).restoreEditorViewState({
        scrollLeft: 60,
      });

      expect(code.additions.scrollLeft).toBe(60);
      expect(code.deletions?.scrollLeft).toBe(60);
    } finally {
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });

  test('uses CodeView logical scrolling without changing viewport geometry', () => {
    const dom = installDom();
    const root = document.createElement('div');
    root.scrollTop = 200;
    const { codeView, scrollCalls } = createAdvancedVirtualizer(
      root,
      11_100_000
    );
    const file = new VirtualizedFile({}, codeView);
    const fileDiff = new VirtualizedFileDiff({}, codeView);

    try {
      expect(viewStateOperations(file).captureEditorViewState()).toEqual({
        scrollTop: 11_100_000,
      });
      expect(viewStateOperations(fileDiff).captureEditorViewState()).toEqual({
        scrollTop: 11_100_000,
      });

      viewStateOperations(file).restoreEditorViewState({
        scrollTop: 11_200_000,
      });
      viewStateOperations(fileDiff).restoreEditorViewState({
        scrollTop: 11_300_000,
      });

      expect(scrollCalls).toEqual([
        {
          type: 'position',
          position: 11_200_000,
          behavior: 'instant',
        },
        {
          type: 'position',
          position: 11_300_000,
          behavior: 'instant',
        },
      ]);
      expect(file.getEditorViewport()).toBe(root);
      expect(fileDiff.getEditorViewport()).toBe(root);
    } finally {
      file.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });
});
