import { afterAll, describe, expect, test } from 'bun:test';

import {
  CodeView,
  type CodeViewCreateEditorOptions,
  type CodeViewOptions,
} from '../src/components/CodeView';
import { DEFAULT_CODE_VIEW_FILE_METRICS } from '../src/constants';
import {
  Editor,
  type EditPredictProvider,
  type EditPredictResponse,
} from '../src/editor/editor';
import type { EditorType } from '../src/editor/types';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { CodeViewItem } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  dispatchScroll,
  installDom,
  makeFile,
  makeFileItem,
  renderItems,
  wait,
  waitFor,
} from './domHarness';
import { assertDefined, createDeferred, type Deferred } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

const { lineHeight: LINE_HEIGHT } = DEFAULT_CODE_VIEW_FILE_METRICS;
// The predicted insertion carries two line breaks, so two ghost rows sit under
// the anchor line.
const GHOST_ROWS = 2;
const GHOST_HEIGHT = GHOST_ROWS * LINE_HEIGHT;
// Zero-based document line the prediction anchors to, and its text.
const ANCHOR_LINE = 5;
const ANCHOR_TEXT = 'line 6';
// One-based line number below the anchor whose position must move with the
// ghost rows. Both fixtures have at least this many lines.
const BELOW_LINE_NUMBER = 12;
const FILE_LINE_COUNT = 30;
const DIFF_LINE_COUNT = 15;
const EDITABLE_TIMEOUT = 3_000;
const PREDICT_TIMEOUT = 2_000;

const GHOST_RESPONSE: EditPredictResponse = {
  edits: [
    {
      range: {
        start: { line: ANCHOR_LINE, character: ANCHOR_TEXT.length },
        end: { line: ANCHOR_LINE, character: ANCHOR_TEXT.length },
      },
      newText: '\nghostOne();\nghostTwo();',
    },
  ],
  newCursor: { line: ANCHOR_LINE + 2, character: 'ghostTwo();'.length },
};

type ItemType = 'diff' | 'file';
type ViewerEditor = NonNullable<ReturnType<CodeView['getEditor']>>;
type RenderedItem = ReturnType<CodeView['getRenderedItems']>[number];

interface Fixture {
  cleanup(): Promise<void>;
  editorA: ViewerEditor;
  elementA: HTMLElement;
  instanceA: RenderedItem['instance'];
  options: CodeViewOptions<undefined, undefined>;
  // Provider responses parked by a fixture created with deferResponses.
  pending: Deferred<EditPredictResponse>[];
  root: HTMLDivElement;
  viewer: CodeView;
}

// Model values CodeView derives from an item's folded ghost rows: the next
// item's absolute top, item A's sticky height, the scroll container's height,
// and the top of a line below the anchor inside item A.
interface LayoutSnapshot {
  belowLineTop: number;
  containerHeight: number;
  heightA: number;
  topB: number;
}

function makeItemA(itemType: ItemType): CodeViewItem<undefined> {
  if (itemType === 'file') {
    return {
      id: 'a',
      type: 'file',
      file: makeFile('a.ts', FILE_LINE_COUNT),
      version: 0,
      edit: true,
    };
  }
  // Every line differs, so the unified view renders one hunk of deletion rows
  // followed by addition rows with no collapsed regions or separators.
  const oldContents = Array.from(
    { length: DIFF_LINE_COUNT },
    (_, index) => `old ${index + 1}`
  ).join('\n');
  return {
    id: 'a',
    type: 'diff',
    fileDiff: parseDiffFromFile(
      { name: 'a.ts', contents: oldContents },
      makeFile('a.ts', DIFF_LINE_COUNT)
    ),
    version: 0,
    edit: true,
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

function predictionElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.shadowRoot?.querySelectorAll<HTMLElement>(
      '[data-edit-prediction]'
    ) ?? []
  );
}

// The editable row for a one-based line number, skipping unified deletion rows
// that share the number.
function findLineRow(
  container: HTMLElement,
  lineNumber: number
): HTMLElement | null {
  return (
    container.shadowRoot?.querySelector<HTMLElement>(
      `[data-content] > [data-line="${lineNumber}"]:not([data-line-type="change-deletion"])`
    ) ?? null
  );
}

function findRendered(viewer: CodeView, id: string): RenderedItem {
  const rendered = viewer
    .getRenderedItems()
    .find((candidate) => candidate.id === id);
  assertDefined(rendered, `expected item "${id}" to be rendered`);
  return rendered;
}

function setCaret(editor: ViewerEditor, line: number, character: number): void {
  const position = { line, character };
  editor.setSelections([{ start: position, end: position, direction: 'none' }]);
}

function dispatchKey(content: HTMLElement, key: string): KeyboardEvent {
  const view = content.ownerDocument.defaultView;
  assertDefined(view, 'editor content is not attached to a window');
  const event = new view.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    key,
  });
  content.dispatchEvent(event);
  return event;
}

// The scroll container is the root's only child; it holds the sticky offset
// spacer and the sticky container that hosts the rendered items.
function getScrollContainer(viewer: CodeView): HTMLElement {
  const container = viewer.getContainerElement()?.firstElementChild;
  if (!(container instanceof HTMLElement)) {
    throw new Error('expected the CodeView scroll container to be mounted');
  }
  return container;
}

function getStickyContainer(viewer: CodeView): HTMLElement {
  const sticky = Array.from(getScrollContainer(viewer).children).find(
    (child) => child instanceof HTMLElement && child.style.position === 'sticky'
  );
  if (!(sticky instanceof HTMLElement)) {
    throw new Error('expected the CodeView sticky container to be mounted');
  }
  return sticky;
}

function snapshotLayout(
  viewer: CodeView,
  instanceA: RenderedItem['instance']
): LayoutSnapshot {
  const topB = viewer.getTopForItem('b');
  assertDefined(topB, 'expected a layout top for item B');
  const specsA = instanceA.getAdvancedStickySpecs();
  assertDefined(specsA, 'expected sticky specs for item A');
  const belowLine = instanceA.getLinePosition(BELOW_LINE_NUMBER);
  assertDefined(belowLine, 'expected a line position below the anchor');
  return {
    belowLineTop: belowLine.top,
    containerHeight: Number.parseFloat(getScrollContainer(viewer).style.height),
    heightA: specsA.height,
    topB,
  };
}

function expectShift(
  before: LayoutSnapshot,
  after: LayoutSnapshot,
  delta: number
): void {
  expect(after.topB - before.topB).toBe(delta);
  expect(after.heightA - before.heightA).toBe(delta);
  expect(after.containerHeight - before.containerHeight).toBe(delta);
  expect(after.belowLineTop - before.belowLineTop).toBe(delta);
}

// The sticky container height a browser would report for the rendered slice:
// from the first rendered item's sticky top to the last one's sticky bottom.
function measureStickyHeight(viewer: CodeView): number {
  const rendered = viewer.getRenderedItems();
  const first = rendered[0]?.instance.getAdvancedStickySpecs();
  const last = rendered.at(-1)?.instance.getAdvancedStickySpecs();
  assertDefined(first, 'expected sticky specs for the first rendered item');
  assertDefined(last, 'expected sticky specs for the last rendered item');
  return last.topOffset + last.height - Math.max(first.topOffset, 0);
}

// jsdom performs no layout and the harness ResizeObserver never fires, so feed
// the private resize handler a synthetic sticky-container entry, the same path
// the real observer takes when the ghost margin grows the rendered slice.
function resizeStickyContainer(viewer: CodeView, blockSize: number): void {
  const entry = {
    target: getStickyContainer(viewer),
    borderBoxSize: [{ blockSize, inlineSize: 1000 }],
    contentBoxSize: [{ blockSize, inlineSize: 1000 }],
  } as unknown as ResizeObserverEntry;
  (
    viewer as unknown as {
      handleResize(entries: ResizeObserverEntry[]): void;
    }
  ).handleResize([entry]);
}

// Two edit-mode items, A above B, both fully inside the render window, plus
// optional read-only fillers below so A can be scrolled out of the window.
async function createFixture({
  deferResponses = false,
  fillerCount = 0,
  itemType = 'file',
}: {
  deferResponses?: boolean;
  fillerCount?: number;
  itemType?: ItemType;
} = {}): Promise<Fixture> {
  const dom = installDom();
  const root = createRoot();
  const pending: Deferred<EditPredictResponse>[] = [];
  const provider: EditPredictProvider = {
    predict() {
      if (!deferResponses) {
        return Promise.resolve(GHOST_RESPONSE);
      }
      const deferred = createDeferred<EditPredictResponse>();
      pending.push(deferred);
      return deferred.promise;
    },
  };
  const createEditor = <EType extends EditorType>(
    editorType: EType,
    options: CodeViewCreateEditorOptions<EType, undefined, undefined>,
    editStateKey?: string
  ): Editor<EType, undefined> =>
    new Editor(
      editorType,
      { ...options, editPrediction: { provider } },
      editStateKey
    );
  const options: CodeViewOptions<undefined, undefined> = {
    createEditor,
    diffStyle: 'unified',
  };
  const viewer = new CodeView(options);
  const items: CodeViewItem<undefined>[] = [
    makeItemA(itemType),
    { ...makeFileItem('b', FILE_LINE_COUNT), version: 0, edit: true },
    ...Array.from({ length: fillerCount }, (_, index) =>
      makeFileItem(`filler-${index}`, FILE_LINE_COUNT)
    ),
  ];

  viewer.setup(root);
  await renderItems(viewer, items);
  const renderedA = findRendered(viewer, 'a');
  expect(renderedA.type).toBe(itemType);
  await waitFor(() => findEditableContent(renderedA.element) != null, {
    timeout: EDITABLE_TIMEOUT,
  });
  expect(findEditableContent(renderedA.element)).toBeInstanceOf(HTMLElement);
  const editorA = viewer.getEditor('a');
  assertDefined(editorA, 'expected an editor for item A');

  return {
    async cleanup() {
      viewer.cleanUp();
      await wait(0);
      dom.cleanup();
    },
    editorA,
    elementA: renderedA.element,
    instanceA: renderedA.instance,
    options,
    pending,
    root,
    viewer,
  };
}

// Places the caret at the anchor, waits for the ghost text to render, and runs
// the layout pass the editor requested through syncGhostTextRows.
async function showGhost(fixture: Fixture): Promise<void> {
  setCaret(fixture.editorA, ANCHOR_LINE, ANCHOR_TEXT.length);
  await waitFor(() => predictionElements(fixture.elementA).length > 0, {
    timeout: PREDICT_TIMEOUT,
  });
  expect(predictionElements(fixture.elementA)).toHaveLength(1);
  fixture.viewer.render(true);
}

describe('CodeView edit prediction ghost rows', () => {
  test('folds ghost rows under a file item into the layout', async () => {
    const fixture = await createFixture();
    const { viewer, instanceA } = fixture;
    try {
      const baseline = snapshotLayout(viewer, instanceA);

      await showGhost(fixture);

      const folded = snapshotLayout(viewer, instanceA);
      expectShift(baseline, folded, GHOST_HEIGHT);
      // The anchor line itself owns the extra rows.
      expect(instanceA.getLinePosition(ANCHOR_LINE + 1)?.height).toBe(
        LINE_HEIGHT + GHOST_HEIGHT
      );
      expect(viewer.getScrollTop()).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  test('Escape drops the folded rows on the next pass', async () => {
    const fixture = await createFixture();
    const { viewer, instanceA, elementA } = fixture;
    try {
      const baseline = snapshotLayout(viewer, instanceA);
      await showGhost(fixture);
      expectShift(baseline, snapshotLayout(viewer, instanceA), GHOST_HEIGHT);

      const content = findEditableContent(elementA);
      assertDefined(content, 'expected item A to stay editable');
      const escape = dispatchKey(content, 'Escape');
      expect(escape.defaultPrevented).toBe(true);
      expect(predictionElements(elementA)).toHaveLength(0);
      viewer.render(true);

      expect(snapshotLayout(viewer, instanceA)).toEqual(baseline);
      expect(instanceA.getLinePosition(ANCHOR_LINE + 1)?.height).toBe(
        LINE_HEIGHT
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test('a sticky container resize after the fold changes nothing', async () => {
    const fixture = await createFixture();
    const { viewer, instanceA } = fixture;
    try {
      const baseline = snapshotLayout(viewer, instanceA);
      await showGhost(fixture);
      const folded = snapshotLayout(viewer, instanceA);
      expectShift(baseline, folded, GHOST_HEIGHT);

      // Report a height one pixel off the recorded sticky height so the
      // handler takes the reconcile path instead of returning early.
      resizeStickyContainer(viewer, measureStickyHeight(viewer) + 1);
      viewer.render(true);

      expect(snapshotLayout(viewer, instanceA)).toEqual(folded);
      expect(viewer.getScrollTop()).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  test('a resize before the layout pass folds the rows through reconcileHeights', async () => {
    const fixture = await createFixture({ deferResponses: true });
    const { viewer, instanceA, elementA, editorA, pending } = fixture;
    try {
      const baseline = snapshotLayout(viewer, instanceA);
      const stickyHeight = measureStickyHeight(viewer);

      setCaret(editorA, ANCHOR_LINE, ANCHOR_TEXT.length);
      await waitFor(() => pending.length === 1, { timeout: PREDICT_TIMEOUT });
      expect(pending).toHaveLength(1);

      // Resolve the provider and let only microtasks run: the editor draws
      // the ghost text and requests a layout pass, but that pass waits for the
      // next animation frame.
      pending[0].resolve(GHOST_RESPONSE);
      await Promise.resolve();
      await Promise.resolve();
      expect(predictionElements(elementA)).toHaveLength(1);
      expect(snapshotLayout(viewer, instanceA)).toEqual(baseline);

      // The browser measures the grown sticky container first. Reconcile folds
      // the rows into the model; the container height only syncs in a pass.
      resizeStickyContainer(viewer, stickyHeight + GHOST_HEIGHT);
      const reconciled = snapshotLayout(viewer, instanceA);
      expect(reconciled.topB - baseline.topB).toBe(GHOST_HEIGHT);
      expect(reconciled.heightA - baseline.heightA).toBe(GHOST_HEIGHT);
      expect(reconciled.belowLineTop - baseline.belowLineTop).toBe(
        GHOST_HEIGHT
      );

      viewer.render(true);
      expectShift(baseline, snapshotLayout(viewer, instanceA), GHOST_HEIGHT);
    } finally {
      await fixture.cleanup();
    }
  });

  test('a same-size rebuild keeps the folded rows', async () => {
    const fixture = await createFixture();
    const { viewer, instanceA, elementA, options } = fixture;
    try {
      const baseline = snapshotLayout(viewer, instanceA);
      await showGhost(fixture);
      const folded = snapshotLayout(viewer, instanceA);
      expectShift(baseline, folded, GHOST_HEIGHT);
      const rowBefore = findLineRow(elementA, ANCHOR_LINE + 1);
      expect(rowBefore?.dataset.editPredictionSpacer).toBe('');

      // A changed option re-renders every mounted item's rows in place; the
      // editor re-tags the new rows once its render view syncs.
      viewer.setOptions({ ...options, themeType: 'light' });
      viewer.render(true);
      await waitFor(
        () => {
          const row = findLineRow(elementA, ANCHOR_LINE + 1);
          return (
            row != null &&
            row !== rowBefore &&
            row.dataset.editPredictionSpacer === ''
          );
        },
        { timeout: EDITABLE_TIMEOUT }
      );
      const rowAfter = findLineRow(elementA, ANCHOR_LINE + 1);
      expect(rowAfter).not.toBe(rowBefore);
      expect(rowAfter?.dataset.editPredictionSpacer).toBe('');
      expect(predictionElements(elementA)).toHaveLength(1);
      viewer.render(true);

      expect(snapshotLayout(viewer, instanceA)).toEqual(folded);
    } finally {
      await fixture.cleanup();
    }
  });

  test('recycling the item drops its folded rows and remounts cleanly', async () => {
    const fixture = await createFixture({ fillerCount: 20 });
    const { viewer, instanceA, editorA, root } = fixture;
    try {
      const baseline = snapshotLayout(viewer, instanceA);
      const baselineHeightA = instanceA.getVirtualizedHeight();
      await showGhost(fixture);
      expect(instanceA.getVirtualizedHeight()).toBe(
        baselineHeightA + GHOST_HEIGHT
      );

      // Scroll both edited items out of the window. Releasing A marks it
      // layout-dirty, and the pass that follows recomputes without the rows.
      root.scrollTop = 6_000;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);
      viewer.render(true);

      expect(
        viewer.getRenderedItems().some((rendered) => rendered.id === 'a')
      ).toBe(false);
      expect(viewer.getTopForItem('b')).toBe(baseline.topB);
      expect(instanceA.getVirtualizedHeight()).toBe(baselineHeightA);

      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      const remounted = findRendered(viewer, 'a');
      expect(remounted.instance).toBe(instanceA);
      expect(
        remounted.element.shadowRoot?.querySelector('[data-error-wrapper]')
      ).toBeNull();
      expect(viewer.getEditor('a')).toBe(editorA);
      await waitFor(() => findEditableContent(remounted.element) != null, {
        timeout: EDITABLE_TIMEOUT,
      });
      expect(predictionElements(remounted.element)).toHaveLength(0);
      expect(snapshotLayout(viewer, instanceA)).toEqual(baseline);
    } finally {
      await fixture.cleanup();
    }
  });

  test('folds ghost rows under a unified diff item into the layout', async () => {
    const fixture = await createFixture({ itemType: 'diff' });
    const { viewer, instanceA } = fixture;
    try {
      const baseline = snapshotLayout(viewer, instanceA);

      await showGhost(fixture);

      expectShift(baseline, snapshotLayout(viewer, instanceA), GHOST_HEIGHT);
      expect(viewer.getScrollTop()).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
