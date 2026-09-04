import { afterAll, describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { DEFAULT_THEMES, DEFAULT_VIRTUAL_FILE_METRICS } from '../src/constants';
import { Editor, type EditPredictProvider } from '../src/editor/editor';
import type { EditorType } from '../src/editor/types';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents, FileDiffMetadata } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const FILE_NAME = 'src/ghost.ts';
const PREDICT_TIMEOUT = 2_000;
const { lineHeight } = DEFAULT_VIRTUAL_FILE_METRICS;

// Line 2 (zero-based 1) is the ghost text anchor. In the diff fixtures it is
// the changed line, so the additions row index differs from the line index in
// unified mode and the translation through getLineIndexForDiff is exercised.
const ANCHOR_LINE = 'next();';
const CONTENTS = `alpha();\n${ANCHOR_LINE}\nend();\nlast();`;
const OLD_CONTENTS = 'alpha();\nprevious();\nend();\nlast();';
const ANCHOR = { line: 1, character: ANCHOR_LINE.length };
// Three predicted lines: the first continues the anchor row, the other two
// need rows of their own below it.
const GHOST_TEXT = '\nghostOne();\nghostTwo();';
const GHOST_ROWS = 2;

type Surface = 'File' | 'unified' | 'split';

const SURFACE_LABELS: Record<Surface, string> = {
  File: 'VirtualizedFile',
  unified: 'VirtualizedFileDiff unified',
  split: 'VirtualizedFileDiff split',
};

interface LinePosition {
  top: number;
  height: number;
}

interface LayoutHost {
  editor: Editor<EditorType, undefined, undefined>;
  content: HTMLElement;
  // Every instance passed to the virtualizer's requestHeightReconcile, in
  // order. Emptied once the mount settles so tests only see their own calls.
  reconcileRequests: object[];
  instance: VirtualizedFile<undefined> | VirtualizedFileDiff<undefined>;
  getHeight(): number;
  getLinePosition(lineNumber: number): LinePosition | undefined;
  reconcileHeights(): boolean;
  // Public path that wipes the layout cache without recomputing it.
  resetLayoutCache(): void;
  // Public path that recomputes layout for the current target.
  relayout(): number;
  isLayoutDirty(): boolean;
  // Number of rows carrying a folded height (heights / heightDeltas size).
  foldedRowCount(): number;
  // Total px the cache adds on top of one line height per row.
  foldedExtraHeight(): number;
  // Sparse layout checkpoints built by the last layout walk.
  checkpointCount(): number;
  cleanup(): Promise<void>;
}

interface InspectableVirtualizedFile {
  cache: {
    heights: Map<number, number>;
    ghostTextRows: ReadonlyMap<number, number>;
    checkpoints: unknown[];
  };
  layoutDirty: boolean;
}

interface InspectableVirtualizedFileDiff {
  cache: {
    heightDeltas: Map<number, number>;
    measuredHeightDeltaTotal: number;
    ghostTextRows: ReadonlyMap<number, number>;
    ghostTextRowsByIndex: Map<number, number>;
    checkpoints: unknown[];
  };
  layoutDirty: boolean;
}

function inspectFile(
  instance: VirtualizedFile<undefined>
): InspectableVirtualizedFile {
  return instance as unknown as InspectableVirtualizedFile;
}

function inspectFileDiff(
  instance: VirtualizedFileDiff<undefined>
): InspectableVirtualizedFileDiff {
  return instance as unknown as InspectableVirtualizedFileDiff;
}

// A simple Virtualizer stand-in that renders synchronously on instanceChanged
// and records every requestHeightReconcile call instead of running the pass.
// Tests run the reconcile themselves so each layout step can be observed.
function createRecordingVirtualizer(root: HTMLElement) {
  const reconcileRequests: object[] = [];
  const virtualizer = {
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
    requestHeightReconcile(instance: object) {
      reconcileRequests.push(instance);
    },
  } as never;
  return { virtualizer, reconcileRequests };
}

function createGhostProvider(
  anchor: { line: number; character: number } = ANCHOR
): EditPredictProvider {
  return {
    predict() {
      return Promise.resolve({
        edits: [{ range: { start: anchor, end: anchor }, newText: GHOST_TEXT }],
        newCursor: { line: anchor.line + 2, character: 'ghostTwo();'.length },
      });
    },
  };
}

function findEditableContent(container: HTMLElement): HTMLElement | undefined {
  return Array.from(
    container.shadowRoot?.querySelectorAll<HTMLElement>('[data-content]') ?? []
  ).find(
    (element) =>
      element.contentEditable === 'true' ||
      element.getAttribute('contenteditable') === 'true'
  );
}

function setCaret(
  editor: Editor<EditorType, undefined, undefined>,
  line: number,
  character: number
): void {
  const position = { line, character };
  editor.setSelections([{ start: position, end: position, direction: 'none' }]);
}

function dispatchKey(content: HTMLElement, key: string): KeyboardEvent {
  const view = content.ownerDocument.defaultView;
  if (view == null) {
    throw new Error('editor content is not attached to a window');
  }
  const event = new view.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    key,
  });
  content.dispatchEvent(event);
  return event;
}

function createLines(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line ${index + 1};`);
}

async function createHost(
  surface: Surface,
  {
    contents = CONTENTS,
    oldContents = OLD_CONTENTS,
    expandUnchanged = false,
  }: { contents?: string; oldContents?: string; expandUnchanged?: boolean } = {}
): Promise<LayoutHost> {
  const dom = installDom();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const { virtualizer, reconcileRequests } = createRecordingVirtualizer(root);
  const fileContainer = document.createElement('div');
  root.appendChild(fileContainer);
  const editor = new Editor<EditorType, undefined, undefined>(
    surface === 'File' ? 'file' : 'file-diff',
    { editPrediction: { provider: createGhostProvider() } }
  );

  // Let the component finish its first paint (a cold highlighter completes it
  // asynchronously) before the editor takes over rendering.
  const waitForCode = () =>
    waitFor(
      () =>
        fileContainer.shadowRoot?.querySelector(
          '[data-code]:not([data-deletions])'
        ) instanceof HTMLElement,
      { timeout: 3_000 }
    );

  let host: Omit<LayoutHost, 'editor' | 'content' | 'reconcileRequests'>;
  if (surface === 'File') {
    const file: FileContents = { name: FILE_NAME, contents };
    const instance = new VirtualizedFile<undefined>(
      { disableFileHeader: true, theme: DEFAULT_THEMES },
      virtualizer
    );
    instance.render({ file, fileContainer, forceRender: true });
    await waitForCode();
    editor.edit(instance);
    host = {
      instance,
      getHeight: () => instance.getVirtualizedHeight(),
      getLinePosition: (lineNumber) => instance.getLinePosition(lineNumber),
      reconcileHeights: () => instance.reconcileHeights(),
      resetLayoutCache: () => instance.setMetrics(undefined, true),
      relayout: () => instance.updateCodeViewLayout(file, 0),
      isLayoutDirty: () => inspectFile(instance).layoutDirty,
      foldedRowCount: () => inspectFile(instance).cache.heights.size,
      foldedExtraHeight() {
        let total = 0;
        for (const height of inspectFile(instance).cache.heights.values()) {
          total += height - lineHeight;
        }
        return total;
      },
      checkpointCount: () => inspectFile(instance).cache.checkpoints.length,
      async cleanup() {
        editor.cleanUp();
        instance.cleanUp();
        await wait(0);
        dom.cleanup();
      },
    };
  } else {
    const fileDiff: FileDiffMetadata = parseDiffFromFile(
      { name: FILE_NAME, contents: oldContents },
      { name: FILE_NAME, contents }
    );
    const instance = new VirtualizedFileDiff<undefined>(
      {
        diffStyle: surface,
        disableFileHeader: true,
        expandUnchanged,
        theme: DEFAULT_THEMES,
      },
      virtualizer
    );
    instance.render({ fileDiff, fileContainer, forceRender: true });
    await waitForCode();
    editor.edit(instance);
    host = {
      instance,
      getHeight: () => instance.getVirtualizedHeight(),
      getLinePosition: (lineNumber) =>
        instance.getLinePosition(lineNumber, 'additions'),
      reconcileHeights: () => instance.reconcileHeights(),
      resetLayoutCache: () => instance.setMetrics(undefined, true),
      relayout: () => instance.updateCodeViewLayout(fileDiff, 0),
      isLayoutDirty: () => inspectFileDiff(instance).layoutDirty,
      foldedRowCount: () => inspectFileDiff(instance).cache.heightDeltas.size,
      foldedExtraHeight: () =>
        inspectFileDiff(instance).cache.measuredHeightDeltaTotal,
      checkpointCount: () => inspectFileDiff(instance).cache.checkpoints.length,
      async cleanup() {
        editor.cleanUp();
        instance.cleanUp();
        await wait(0);
        dom.cleanup();
      },
    };
  }

  await waitFor(() => findEditableContent(fileContainer) !== undefined, {
    timeout: 3_000,
  });
  const content = findEditableContent(fileContainer);
  if (content === undefined) {
    throw new Error(`${surface} host did not become editable`);
  }
  // Attach-time renders queue their own reconciles; drop those so the tests
  // only count requests caused by ghost text changes.
  await wait(20);
  reconcileRequests.length = 0;

  return { ...host, editor, content, reconcileRequests };
}

async function showGhostText(host: LayoutHost): Promise<void> {
  setCaret(host.editor, ANCHOR.line, ANCHOR.character);
  await waitFor(() => host.editor.__getGhostTextRows().size > 0, {
    timeout: PREDICT_TIMEOUT,
  });
  expect(host.editor.__getGhostTextRows()).toEqual(
    new Map([[ANCHOR.line, GHOST_ROWS]])
  );
}

function readLayout(host: LayoutHost) {
  return {
    height: host.getHeight(),
    line1: host.getLinePosition(1),
    line2: host.getLinePosition(2),
    line3: host.getLinePosition(3),
  };
}

describe('edit prediction ghost rows in virtualized layout', () => {
  for (const surface of ['File', 'unified', 'split'] as const) {
    const label = SURFACE_LABELS[surface];

    test(`${label}: reconcile folds two ghost rows under the anchor line`, async () => {
      const host = await createHost(surface);
      try {
        const baseline = readLayout(host);
        expect(baseline.line2?.height).toBe(lineHeight);

        await showGhostText(host);
        // syncGhostTextRows only queues a pass; nothing moves until it runs.
        expect(readLayout(host)).toEqual(baseline);

        expect(host.reconcileHeights()).toBe(true);
        expect(host.getHeight()).toBe(
          baseline.height + GHOST_ROWS * lineHeight
        );
        expect(host.getLinePosition(1)).toEqual(baseline.line1);
        expect(host.getLinePosition(2)).toEqual({
          top: baseline.line2!.top,
          height: (GHOST_ROWS + 1) * lineHeight,
        });
        expect(host.getLinePosition(3)).toEqual({
          top: baseline.line3!.top + GHOST_ROWS * lineHeight,
          height: lineHeight,
        });
        expect(host.foldedRowCount()).toBe(1);
        expect(host.foldedExtraHeight()).toBe(GHOST_ROWS * lineHeight);
      } finally {
        await host.cleanup();
      }
    });

    test(`${label}: requests one reconcile per ghost row change and none for a re-sync`, async () => {
      const host = await createHost(surface);
      try {
        await showGhostText(host);
        await wait(20);
        expect(host.reconcileRequests).toEqual([host.instance]);
        const ghostTextRows = host.editor.__getGhostTextRows();

        expect(host.reconcileHeights()).toBe(true);
        const folded = readLayout(host);

        // Same caret: the editor re-syncs its spacers, finds the same rows,
        // keeps the map instance, and does not ask for another pass.
        setCaret(host.editor, ANCHOR.line, ANCHOR.character);
        await wait(20);
        expect(host.editor.__getGhostTextRows()).toBe(ghostTextRows);
        expect(host.reconcileRequests).toHaveLength(1);

        expect(host.reconcileHeights()).toBe(false);
        expect(readLayout(host)).toEqual(folded);
        expect(host.foldedRowCount()).toBe(1);
      } finally {
        await host.cleanup();
      }
    });

    test(`${label}: Escape drops the rows and empties the cache`, async () => {
      const host = await createHost(surface);
      try {
        const baseline = readLayout(host);
        await showGhostText(host);
        expect(host.reconcileHeights()).toBe(true);
        expect(readLayout(host)).not.toEqual(baseline);

        expect(dispatchKey(host.content, 'Escape').defaultPrevented).toBe(true);
        expect(host.editor.__getGhostTextRows().size).toBe(0);
        expect(host.reconcileRequests).toEqual([host.instance, host.instance]);

        expect(host.reconcileHeights()).toBe(true);
        expect(readLayout(host)).toEqual(baseline);
        expect(host.foldedRowCount()).toBe(0);
        expect(host.foldedExtraHeight()).toBe(0);

        expect(host.reconcileHeights()).toBe(false);
      } finally {
        await host.cleanup();
      }
    });

    test(`${label}: a layout cache reset re-folds the rows exactly once`, async () => {
      const host = await createHost(surface);
      try {
        const baseline = readLayout(host);
        await showGhostText(host);
        expect(host.reconcileHeights()).toBe(true);
        const folded = readLayout(host);

        host.resetLayoutCache();
        expect(host.foldedRowCount()).toBe(0);
        expect(host.isLayoutDirty()).toBe(true);

        expect(host.reconcileHeights()).toBe(true);
        expect(readLayout(host)).toEqual(folded);
        expect(host.getHeight()).toBe(
          baseline.height + GHOST_ROWS * lineHeight
        );
        expect(host.foldedRowCount()).toBe(1);
        expect(host.foldedExtraHeight()).toBe(GHOST_ROWS * lineHeight);

        expect(host.reconcileHeights()).toBe(false);
        expect(readLayout(host)).toEqual(folded);
      } finally {
        await host.cleanup();
      }
    });

    test(`${label}: recycling marks layout dirty so the next pass drops the rows`, async () => {
      const host = await createHost(surface);
      try {
        const baseline = readLayout(host);
        await showGhostText(host);
        expect(host.reconcileHeights()).toBe(true);
        expect(host.isLayoutDirty()).toBe(false);
        const requestCount = host.reconcileRequests.length;

        host.instance.cleanUp(true);
        // The editor cleared its rows without asking for a pass; the instance
        // keeps the folded heights but is marked so its next pass corrects them.
        expect(host.editor.__getGhostTextRows().size).toBe(0);
        expect(host.reconcileRequests).toHaveLength(requestCount);
        expect(host.isLayoutDirty()).toBe(true);
        expect(host.foldedRowCount()).toBe(1);

        expect(host.relayout()).toBe(baseline.height);
        expect(host.getHeight()).toBe(baseline.height);
        expect(host.foldedRowCount()).toBe(0);
        expect(host.foldedExtraHeight()).toBe(0);
        expect(host.isLayoutDirty()).toBe(false);
      } finally {
        await host.cleanup();
      }
    });
  }

  // The diff twin places a layout checkpoint every 3000 rendered rows and
  // resumes deep lookups from the nearest one, so a spacer near the top has to
  // be reflected in the checkpoints that follow it.
  for (const diffStyle of ['unified', 'split'] as const) {
    test(`${SURFACE_LABELS[diffStyle]}: ghost rows shift lines past a layout checkpoint`, async () => {
      const oldLines = createLines(3_200);
      const newLines = oldLines.with(ANCHOR.line, ANCHOR_LINE);
      const host = await createHost(diffStyle, {
        contents: newLines.join('\n'),
        oldContents: oldLines.join('\n'),
        expandUnchanged: true,
      });
      try {
        const deepLine = 3_100;
        const lastLine = newLines.length;
        const deepBaseline = host.getLinePosition(deepLine);
        const lastBaseline = host.getLinePosition(lastLine);
        const baselineHeight = host.getHeight();
        expect(host.checkpointCount()).toBeGreaterThan(1);

        await showGhostText(host);
        expect(host.reconcileHeights()).toBe(true);

        expect(host.getHeight()).toBe(baselineHeight + GHOST_ROWS * lineHeight);
        expect(host.getLinePosition(deepLine)).toEqual({
          top: deepBaseline!.top + GHOST_ROWS * lineHeight,
          height: lineHeight,
        });
        expect(host.getLinePosition(lastLine)).toEqual({
          top: lastBaseline!.top + GHOST_ROWS * lineHeight,
          height: lineHeight,
        });
        expect(host.checkpointCount()).toBeGreaterThan(1);
      } finally {
        await host.cleanup();
      }
    });
  }
});
