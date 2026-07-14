import { describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import {
  DEFAULT_CODE_VIEW_FILE_METRICS,
  DEFAULT_CODE_VIEW_LAYOUT,
} from '../src/constants';
import type { CodeViewItem } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  dispatchScroll,
  installDom,
  makeFileItem,
  renderItems,
  wait,
} from './domHarness';

const ROOT_HEIGHT = 800;
const ROOT_WIDTH = 1000;

function makeInsertedDiffItem(id: string): CodeViewItem<undefined> {
  const oldLines = Array.from(
    { length: 160 },
    (_, index) => `line ${index + 1}`
  );
  const insertedLines = Array.from(
    { length: 10 },
    (_, index) => `inserted ${index + 1}`
  );
  const newLines = [
    ...oldLines.slice(0, 80),
    ...insertedLines,
    ...oldLines.slice(80),
  ];

  return {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(
      { name: 'src/inserted.ts', contents: oldLines.join('\n') },
      { name: 'src/inserted.ts', contents: newLines.join('\n') }
    ),
  };
}

function makeDeletedDiffItem(id: string): CodeViewItem<undefined> {
  const oldLines = Array.from(
    { length: 160 },
    (_, index) => `line ${index + 1}`
  );
  const newLines = oldLines.toSpliced(80, 1);

  return {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(
      { name: 'src/deleted.ts', contents: oldLines.join('\n') },
      { name: 'src/deleted.ts', contents: newLines.join('\n') },
      { context: 0 }
    ),
  };
}

function getFileLineTop(lineNumber: number): number {
  return (
    DEFAULT_CODE_VIEW_FILE_METRICS.diffHeaderHeight +
    (lineNumber - 1) * DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight
  );
}

function getViewportTopForLocalTop(localTop: number): number {
  return DEFAULT_CODE_VIEW_LAYOUT.paddingTop + localTop;
}

describe('CodeView range scrolling', () => {
  test('scrolls a single-line range to the same position as a line target', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot({ height: ROOT_HEIGHT, width: ROOT_WIDTH });

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:example', 120)]);

      viewer.scrollTo({
        type: 'line',
        id: 'file:example',
        lineNumber: 50,
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);
      const lineScrollTop = root.scrollTop;

      // Anchor the equivalence on the exact derived center position so it
      // cannot pass vacuously with both scroll paths silently no-oping at 0.
      const lineTop = getViewportTopForLocalTop(getFileLineTop(50));
      const lineHeight = DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight;
      expect(lineScrollTop).toBe(lineTop - (ROOT_HEIGHT - lineHeight) / 2);

      viewer.scrollTo({ type: 'position', position: 0, behavior: 'instant' });
      viewer.render(true);

      viewer.scrollTo({
        type: 'range',
        id: 'file:example',
        range: { start: 50, end: 50 },
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);

      expect(root.scrollTop).toBe(lineScrollTop);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('centers a multi-line range as a single region', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot({ height: ROOT_HEIGHT, width: ROOT_WIDTH });

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:example', 120)]);

      viewer.scrollTo({
        type: 'range',
        id: 'file:example',
        range: { start: 20, end: 30 },
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);

      const rangeTop = getViewportTopForLocalTop(getFileLineTop(20));
      const rangeHeight = 11 * DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight;
      const expectedScrollTop = rangeTop - (ROOT_HEIGHT - rangeHeight) / 2;
      expect(root.scrollTop).toBe(expectedScrollTop);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('keeps nearest alignment still when the full range is visible', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot({ height: ROOT_HEIGHT, width: ROOT_WIDTH });

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:example', 120)]);

      root.scrollTop = 500;
      dispatchScroll(root);
      viewer.render(true);

      viewer.scrollTo({
        type: 'range',
        id: 'file:example',
        range: { start: 30, end: 35 },
        align: 'nearest',
        behavior: 'instant',
      });
      viewer.render(true);

      expect(root.scrollTop).toBe(500);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('moves nearest alignment when the range starts above the viewport', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot({ height: ROOT_HEIGHT, width: ROOT_WIDTH });

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:example', 120)]);

      root.scrollTop = 700;
      dispatchScroll(root);
      viewer.render(true);

      viewer.scrollTo({
        type: 'range',
        id: 'file:example',
        range: { start: 30, end: 35 },
        align: 'nearest',
        behavior: 'instant',
      });
      viewer.render(true);

      expect(root.scrollTop).toBe(
        getViewportTopForLocalTop(getFileLineTop(30))
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('falls back to start alignment when a centered range is taller than the viewport', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot({ height: ROOT_HEIGHT, width: ROOT_WIDTH });

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:example', 120)]);

      viewer.scrollTo({
        type: 'range',
        id: 'file:example',
        range: { start: 10, end: 60 },
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);

      expect(root.scrollTop).toBe(
        getViewportTopForLocalTop(getFileLineTop(10))
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('resolves split-view range endpoints against their requested sides', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({ diffStyle: 'split', expandUnchanged: true });
    const root = createRoot({ height: ROOT_HEIGHT, width: ROOT_WIDTH });

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeInsertedDiffItem('diff:inserted')]);

      viewer.scrollTo({
        type: 'range',
        id: 'diff:inserted',
        range: { start: 120, end: 120, side: 'additions' },
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);
      const additionsScrollTop = root.scrollTop;

      viewer.scrollTo({ type: 'position', position: 0, behavior: 'instant' });
      viewer.render(true);

      viewer.scrollTo({
        type: 'range',
        id: 'diff:inserted',
        range: { start: 120, end: 120, side: 'deletions' },
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);

      expect(root.scrollTop - additionsScrollTop).toBe(
        10 * DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('places a context-zero deletion between adjacent addition-side lines', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({ diffStyle: 'split', expandUnchanged: true });
    const root = createRoot({ height: ROOT_HEIGHT, width: ROOT_WIDTH });

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeDeletedDiffItem('diff:deleted')]);

      viewer.scrollTo({
        type: 'line',
        id: 'diff:deleted',
        lineNumber: 80,
        side: 'additions',
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);
      const beforeDeletionScrollTop = root.scrollTop;

      viewer.scrollTo({
        type: 'line',
        id: 'diff:deleted',
        lineNumber: 81,
        side: 'additions',
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);

      expect(root.scrollTop - beforeDeletionScrollTop).toBe(
        2 * DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
