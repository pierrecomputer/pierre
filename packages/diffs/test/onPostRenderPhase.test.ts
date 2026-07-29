import { describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { UnresolvedFile } from '../src/components/UnresolvedFile';
import { DEFAULT_THEMES } from '../src/constants';
import type {
  CodeViewItem,
  FileContents,
  FileDiffMetadata,
  PostRenderPhase,
} from '../src/types';
import { EMPTY_DIFF_LINES } from '../src/utils/diffLines';
import {
  createRoot,
  dispatchScroll,
  installDom,
  renderItems,
  wait,
} from './domHarness';

function createHydrationContainer(): HTMLElement {
  const container = document.createElement('div');
  container.attachShadow({ mode: 'open' });
  return container;
}

function makeFile(
  name: string,
  label: string,
  lineCount: number
): FileContents {
  return {
    name,
    contents: Array.from(
      { length: lineCount },
      (_, index) => `${label} line ${index + 1}`
    ).join('\n'),
  };
}

function makeFileItem(
  id: string,
  label: string,
  lineCount: number
): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: makeFile(`${id}.ts`, label, lineCount),
  };
}

async function waitForPhases(
  phases: readonly { id: string; phase: PostRenderPhase }[],
  expected: readonly { id: string; phase: PostRenderPhase }[]
): Promise<void> {
  // ~4s budget: returns as soon as the phases match, so passing runs only pay
  // a few iterations; the headroom is for loaded CI runners.
  for (let attempt = 0; attempt < 400; attempt++) {
    try {
      expect(phases).toEqual(expected);
      return;
    } catch {
      await wait(10);
    }
  }
  expect(phases).toEqual(expected);
}

const file: FileContents = {
  name: 'file.ts',
  contents: 'const value = 1;\n',
};

const unresolvedFile: FileContents = {
  name: 'file.ts',
  contents: `const value = 1;
<<<<<<< HEAD
const conflict = 'current';
=======
const conflict = 'incoming';
>>>>>>> branch
`,
};

const fileDiff: FileDiffMetadata = {
  name: 'file.ts',
  type: 'change',
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  isPartial: false,
  deletionLines: EMPTY_DIFF_LINES,
  additionLines: EMPTY_DIFF_LINES,
};

describe('onPostRender phases', () => {
  test('File emits mount, update, and unmount around cleanup', () => {
    const { cleanup } = installDom();
    const phases: PostRenderPhase[] = [];
    const instance = new File({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        phases.push(phase);
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ file, fileContainer });
      instance.render({ file, fileContainer, forceRender: true });
      instance.cleanUp();
      instance.cleanUp();

      expect(phases).toEqual(['mount', 'update', 'unmount']);
    } finally {
      cleanup();
    }
  });

  test('FileDiff emits mount, update, and unmount around cleanup', () => {
    const { cleanup } = installDom();
    const phases: PostRenderPhase[] = [];
    const instance = new FileDiff({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        phases.push(phase);
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ fileDiff, fileContainer });
      instance.render({ fileDiff, fileContainer, forceRender: true });
      instance.cleanUp();
      instance.cleanUp();

      expect(phases).toEqual(['mount', 'update', 'unmount']);
    } finally {
      cleanup();
    }
  });

  test('FileDiff emits unmount for the previous container when render swaps containers', () => {
    const { cleanup } = installDom();
    const firstContainer = createHydrationContainer();
    const secondContainer = createHydrationContainer();
    const phases: { container: 'first' | 'second'; phase: PostRenderPhase }[] =
      [];
    const instance = new FileDiff({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(node, _instance, phase) {
        phases.push({
          container: node === firstContainer ? 'first' : 'second',
          phase,
        });
      },
    });

    try {
      instance.render({ fileDiff, fileContainer: firstContainer });
      instance.render({ fileDiff, fileContainer: secondContainer });

      expect(phases).toEqual([
        { container: 'first', phase: 'mount' },
        { container: 'first', phase: 'unmount' },
        { container: 'second', phase: 'mount' },
      ]);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('UnresolvedFile emits mount, update, and unmount around cleanup', () => {
    const { cleanup } = installDom();
    const phases: PostRenderPhase[] = [];
    const instance = new UnresolvedFile({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        phases.push(phase);
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ file: unresolvedFile, fileContainer });
      instance.hydrate({ file: unresolvedFile, fileContainer });
      instance.cleanUp();
      instance.cleanUp();

      expect(phases).toEqual(['mount', 'update', 'unmount']);
    } finally {
      cleanup();
    }
  });

  test('File placeholder rendering unmounts once and allows render remount', () => {
    const { cleanup } = installDom();
    const phases: PostRenderPhase[] = [];
    const instance = new File({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        phases.push(phase);
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ file, fileContainer });
      instance.renderPlaceholder(24);
      instance.renderPlaceholder(48);
      instance.render({ file, fileContainer, forceRender: true });

      expect(phases).toEqual(['mount', 'unmount', 'mount']);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('FileDiff placeholder rendering unmounts once and allows render remount', () => {
    const { cleanup } = installDom();
    const phases: PostRenderPhase[] = [];
    const instance = new FileDiff({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        phases.push(phase);
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ fileDiff, fileContainer });
      instance.renderPlaceholder(24);
      instance.renderPlaceholder(48);
      instance.render({ fileDiff, fileContainer, forceRender: true });

      expect(phases).toEqual(['mount', 'unmount', 'mount']);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('cleanup propagates File unmount callback errors', () => {
    const { cleanup } = installDom();
    const instance = new File({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        if (phase === 'unmount') {
          throw new Error('unmount failed');
        }
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ file, fileContainer });

      expect(() => instance.cleanUp()).toThrow('unmount failed');
      instance.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('CodeView forwards unmount when a rendered item scrolls out', async () => {
    const { cleanup } = installDom();
    const phases: { id: string; phase: PostRenderPhase }[] = [];
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      onPostRender(_node, _instance, phase, context) {
        phases.push({ id: context.item.id, phase });
      },
    });
    const root = createRoot({ height: 120 });
    const items = [
      makeFileItem('file:first', 'first content', 100),
      makeFileItem('file:second', 'second content', 100),
    ];

    try {
      viewer.setup(root);
      await renderItems(viewer, items);

      await waitForPhases(phases, [{ id: 'file:first', phase: 'mount' }]);

      root.scrollTop = 2_400;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      await waitForPhases(phases, [
        { id: 'file:first', phase: 'mount' },
        { id: 'file:first', phase: 'unmount' },
        { id: 'file:second', phase: 'mount' },
      ]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
