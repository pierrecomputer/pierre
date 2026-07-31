import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import type { DiffsEditor } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, waitFor } from './domHarness';

function createSimpleVirtualizer(root: HTMLElement) {
  return {
    type: 'simple',
    config: {},
    connect() {},
    disconnect() {},
    getRoot: () => root,
    getWindowSpecs: () => ({ top: 0, bottom: 800 }),
    getOffsetInScrollContainer: () => 0,
    instanceChanged(instance: { onRender(dirty: boolean): boolean }) {
      instance.onRender(true);
    },
    isInstanceVisible: () => true,
    markDOMDirty() {},
    requestHeightReconcile() {},
  } as never;
}

async function renderFile(
  file: VirtualizedFile<undefined>,
  root: HTMLElement
): Promise<HTMLElement> {
  const fileContainer = document.createElement('div');
  root.appendChild(fileContainer);
  file.render({
    file: { name: 'state.txt', contents: 'alpha\nbravo\n', lang: 'text' },
    fileContainer,
    forceRender: true,
  });
  await waitFor(
    () =>
      fileContainer.shadowRoot?.querySelector('[data-code]') instanceof
      HTMLElement
  );
  const code = fileContainer.shadowRoot?.querySelector('[data-code]');
  expect(code).toBeInstanceOf(HTMLElement);
  return code as HTMLElement;
}

async function renderFileDiff(
  fileDiff: VirtualizedFileDiff<undefined>,
  root: HTMLElement
): Promise<{ additions: HTMLElement; deletions?: HTMLElement }> {
  const fileContainer = document.createElement('div');
  root.appendChild(fileContainer);
  fileDiff.render({
    fileDiff: parseDiffFromFile(
      { name: 'state.txt', contents: 'alpha\nbravo\n', lang: 'text' },
      { name: 'state.txt', contents: 'alpha\ncharlie\n', lang: 'text' }
    ),
    fileContainer,
    forceRender: true,
  });
  await waitFor(
    () =>
      fileContainer.shadowRoot?.querySelector(
        '[data-code]:not([data-deletions])'
      ) instanceof HTMLElement
  );
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

  test('reads and restores File horizontal state from the code scroller', async () => {
    const dom = installDom();
    const root = document.createElement('div');
    root.scrollLeft = 900;
    const virtualizer = createSimpleVirtualizer(root);
    const file = new VirtualizedFile(
      { disableFileHeader: true, theme: DEFAULT_THEMES },
      virtualizer
    );

    try {
      const code = await renderFile(file, root);
      code.scrollLeft = 60;

      expect(file.getCodeScrollLeft()).toBe(60);
      file.setCodeScrollLeft(61);
      expect(code.scrollLeft).toBe(61);

      let recyclePosition: number | undefined;
      file.attachEditor({
        __captureFocusForDOMReplacement() {},
        __postponeBgTokenizeToNextFrame() {},
        __syncRenderView() {},
        edit: () => () => {},
        cleanUp() {
          recyclePosition = file.getCodeScrollLeft();
        },
      } as unknown as DiffsEditor<undefined>);
      code.scrollLeft = 62;
      file.cleanUp(true);
      expect(recyclePosition).toBe(62);
    } finally {
      file.cleanUp();
      dom.cleanup();
    }
  });

  for (const diffStyle of ['unified', 'split'] as const) {
    test(`reads ${diffStyle} FileDiff horizontal state from active code columns`, async () => {
      const dom = installDom();
      const root = document.createElement('div');
      root.scrollLeft = 900;
      const virtualizer = createSimpleVirtualizer(root);
      const fileDiff = new VirtualizedFileDiff(
        {
          diffStyle,
          disableFileHeader: true,
          theme: DEFAULT_THEMES,
        },
        virtualizer
      );

      try {
        const code = await renderFileDiff(fileDiff, root);
        code.additions.scrollLeft = 40;
        if (code.deletions !== undefined) {
          code.deletions.scrollLeft = 60;
        }

        expect(fileDiff.getCodeScrollLeft()).toBe(
          diffStyle === 'split' ? 60 : 40
        );
      } finally {
        fileDiff.cleanUp();
        dom.cleanup();
      }
    });
  }

  test('restores split FileDiff horizontal state to both code columns', async () => {
    const dom = installDom();
    const root = document.createElement('div');
    const virtualizer = createSimpleVirtualizer(root);
    const fileDiff = new VirtualizedFileDiff(
      {
        diffStyle: 'split',
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
      },
      virtualizer
    );

    try {
      const code = await renderFileDiff(fileDiff, root);
      expect(code.deletions).toBeDefined();

      fileDiff.setCodeScrollLeft(60);

      expect(code.additions.scrollLeft).toBe(60);
      expect(code.deletions?.scrollLeft).toBe(60);

      let recyclePosition: number | undefined;
      fileDiff.attachEditor({
        __captureFocusForDOMReplacement() {},
        __postponeBgTokenizeToNextFrame() {},
        __syncRenderView() {},
        edit: () => () => {},
        cleanUp() {
          recyclePosition = fileDiff.getCodeScrollLeft();
        },
      } as unknown as DiffsEditor<undefined>);
      code.deletions!.scrollLeft = 64;
      fileDiff.cleanUp(true);
      expect(recyclePosition).toBe(64);
    } finally {
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });
});
