import { getVirtualizationWorkload } from '@pierre/tree-test-data';

import { createPathStoreScheduler, PathStore } from '../src/index.ts';
import {
  findMoveVisibleFolderToParentCandidate,
  findMoveVisibleLeafToParentCandidate,
  getMovePathToParentPlan,
  getMoveVisibleFolderToParentPlan,
  splitPath,
} from './helpers.js';

const DEFAULT_WORKLOAD_NAME = 'linux-5x';
const MAX_VISIBLE_WINDOW_SIZE = 500;
const DEFAULT_VISIBLE_WINDOW_SIZE = 30;
const ASYNC_DEMO_DIRECTORY_PATH = 'aaa-async-demo/';
const ASYNC_DEMO_PATCH_FILE_PATH = 'aaa-async-demo/inner/file.ts';
const COOPERATIVE_ASYNC_DEMO_DIRECTORY_PATHS = [
  'aaa-cooperative-demo-a/',
  'aaa-cooperative-demo-b/',
  'aaa-cooperative-demo-c/',
];
const COOPERATIVE_ASYNC_DEMO_PATCH_FILE_PATHS = [
  'aaa-cooperative-demo-a/file-a.ts',
  'aaa-cooperative-demo-b/file-b.ts',
  'aaa-cooperative-demo-c/file-c.ts',
];
const PROFILE_END_LABEL = 'path-store-demo-profile-end';
const PROFILE_END_MARK_NAME = 'path-store-demo-profile-end';
const PROFILE_START_LABEL = 'path-store-demo-profile-start';
const PROFILE_START_MARK_NAME = 'path-store-demo-profile-start';
const VISIBLE_PATH_SEARCH_CHUNK_SIZE = 512;
const searchParams = new URLSearchParams(window.location.search);
const instrumentationEnabled = searchParams.get('instrumentation') === '1';
const benchmarkModulePromise = instrumentationEnabled
  ? import('./profile/benchmarkInstrumentation.js')
  : null;

/**
 * @typedef {import('../src/public-types').PathStoreVisibleRow} PathStoreVisibleRow
 */

/**
 * @typedef {{
 *   bounds: { end: number; start: number };
 *   offset: number;
 *   requestedVisibleCount: number;
 *   rows: PathStoreVisibleRow[];
 *   visibleCount: number;
 * }} DemoViewContext
 */

/**
 * @typedef {{
 *   detail: string;
 *   revealPath?: string;
 * }} DemoActionResult
 */

/**
 * @typedef {{
 *   id: string;
 *   prepare: (store: PathStore, view: DemoViewContext) => Record<string, unknown>;
 *   run: (
 *     store: PathStore,
 *     prepared: Record<string, unknown>,
 *     benchmark?: DemoBenchmarkCollector | null
 *   ) => DemoActionResult | Promise<DemoActionResult>;
 * }} DemoAction
 */

/**
 * @typedef {{
 *   action: DemoAction;
 *   prepared: Record<string, unknown>;
 *   view: DemoViewContext;
 * }} PreparedDemoAction
 */

/**
 * @typedef {{
 *   duration: number;
 *   startTime: number;
 * }} DemoLongTaskEntry
 */

/**
 * @typedef {{
 *   counters: Record<string, number>;
 *   heap: {
 *     jsHeapSizeLimitBytes: number;
 *     totalJSHeapSizeAfterBytes: number;
 *     usedJSHeapSizeAfterBytes: number;
 *     usedJSHeapSizeBeforeBytes: number;
 *     usedJSHeapSizeDeltaBytes: number;
 *   } | null;
 *   phases: Array<{
 *     count: number;
 *     durationMs: number;
 *     name: string;
 *     selfDurationMs: number;
 *   }>;
 * }} DemoBenchmarkInstrumentationSummary
 */

/**
 * @typedef {{
 *   attach: <TValue extends object>(value: TValue) => TValue;
 *   instrumentation: {
 *     measurePhase: <TValue>(name: string, fn: () => TValue) => TValue;
 *     setCounter: (name: string, value: number) => void;
 *   };
 *   readHeapSnapshot: () => {
 *     jsHeapSizeLimit: number;
 *     totalJSHeapSize: number;
 *     usedJSHeapSize: number;
 *   } | null;
 *   summarize: (
 *     heapBefore: {
 *       jsHeapSizeLimit: number;
 *       totalJSHeapSize: number;
 *       usedJSHeapSize: number;
 *     } | null,
 *     heapAfter: {
 *       jsHeapSizeLimit: number;
 *       totalJSHeapSize: number;
 *       usedJSHeapSize: number;
 *     } | null
 *   ) => DemoBenchmarkInstrumentationSummary;
 *   reset: () => void;
 * }} DemoBenchmarkCollector
 */

const actionButtons = document.querySelectorAll('button[data-action-id]');
const flattenInput = document.querySelector('#flatten-directories');
const sortInput = document.querySelector('#sort-input');
const visibleCountInput = document.querySelector('#visible-count');
const offsetInput = document.querySelector('#offset');
const offsetValueElement = document.querySelector('#offset-value');
const lastEventElement = document.querySelector('#last-event');
const renderButton = document.querySelector('#render-button');
const rowsElement = document.querySelector('#rows');
const workloadInput = document.querySelector('#workload');

if (
  flattenInput == null ||
  sortInput == null ||
  visibleCountInput == null ||
  offsetInput == null ||
  offsetValueElement == null ||
  lastEventElement == null ||
  renderButton == null ||
  rowsElement == null ||
  workloadInput == null
) {
  throw new Error('Missing demo root elements.');
}

let buildTimeMs = 0;
/** @type {PathStore | null} */
let currentStore = null;
/** @type {import('../src/index.ts').PathStoreScheduler | null} */
let currentScheduler = null;
/** @type {null | (() => void)} */
let currentSchedulerUnsubscribe = null;
/** @type {import('../src/index.ts').PathStoreSchedulerMetrics | null} */
let currentSchedulerMetrics = null;
/** @type {null | (() => void)} */
let currentStoreEventUnsubscribe = null;
/** @type {import('../src/public-types').PathStoreLoadAttempt | null} */
let currentAsyncLoadAttempt = null;
/** @type {import('../src/public-types').PathStoreEvent | null} */
let lastEvent = null;
let schedulerUpdateCount = 0;
/** @type {DemoLongTaskEntry[]} */
const longTaskEntries = [];
const longTaskObserver =
  typeof PerformanceObserver !== 'undefined' &&
  PerformanceObserver.supportedEntryTypes?.includes('longtask')
    ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTaskEntries.push({
            duration: entry.duration,
            startTime: entry.startTime,
          });
        }
      })
    : null;

longTaskObserver?.observe({ type: 'longtask', buffered: true });

async function createBenchmarkCollector() {
  if (benchmarkModulePromise == null) {
    return null;
  }

  const { createBenchmarkInstrumentation } = await benchmarkModulePromise;
  return createBenchmarkInstrumentation();
}

function getSelectedWorkloadName() {
  if (!(workloadInput instanceof HTMLSelectElement)) {
    return DEFAULT_WORKLOAD_NAME;
  }

  return workloadInput.value === ''
    ? DEFAULT_WORKLOAD_NAME
    : workloadInput.value;
}

function getSelectedWorkload() {
  return getVirtualizationWorkload(getSelectedWorkloadName());
}

function getFlattenEmptyDirectoriesEnabled() {
  return (
    flattenInput instanceof HTMLInputElement && flattenInput.checked === true
  );
}

function getSortInputEnabled() {
  return sortInput instanceof HTMLInputElement && sortInput.checked === true;
}

function warmPresortedFilesIfNeeded() {
  if (getSortInputEnabled()) {
    return;
  }

  void getSelectedWorkload().presortedFiles;
}

function logDemoMessage(message) {
  console.info(`[path-store demo] ${message}`);
}

function clearProfileSummary() {
  delete window.__pathStoreDemoProfile;
  performance.clearMarks(PROFILE_START_MARK_NAME);
  performance.clearMarks(PROFILE_END_MARK_NAME);
}

function renderLastEvent() {
  if (!(lastEventElement instanceof HTMLElement)) {
    return;
  }

  lastEventElement.textContent =
    lastEvent == null ? '' : JSON.stringify(lastEvent, null, 2);
}

function clearLastEvent() {
  lastEvent = null;
  renderLastEvent();
}

// Cooperative helpers are created on demand, so reset their metrics whenever
// the demo switches stores or returns to direct non-scheduled actions.
function clearSchedulerState(dispose = true) {
  currentSchedulerUnsubscribe?.();
  currentSchedulerUnsubscribe = null;
  if (dispose) {
    currentScheduler?.dispose();
  }
  currentScheduler = null;
  currentSchedulerMetrics = null;
  schedulerUpdateCount = 0;
}

function subscribeToStoreEvents(store) {
  currentStoreEventUnsubscribe?.();
  currentStoreEventUnsubscribe = store.on('*', (event) => {
    lastEvent = event;
    renderLastEvent();
  });
}

// The scheduler metrics power both Playwright progress checks and profile
// output, so keep the latest snapshot available through getState().
function subscribeToScheduler(scheduler) {
  clearSchedulerState(false);
  currentScheduler = scheduler;
  currentSchedulerUnsubscribe = scheduler.subscribe((metrics) => {
    currentSchedulerMetrics = metrics;
    schedulerUpdateCount += 1;
  });
}

function getTaskOverlapMs(entry, startTime, endTime) {
  const overlapStart = Math.max(entry.startTime, startTime);
  const overlapEnd = Math.min(entry.startTime + entry.duration, endTime);
  return Math.max(0, overlapEnd - overlapStart);
}

async function waitForPaint() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

/**
 * @param {HTMLInputElement} input
 * @param {number} fallbackValue
 * @returns {number}
 */
function getParsedInputNumber(input, fallbackValue) {
  const parsed = Number(input.value);
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function getRequestedVisibleCount() {
  const parsed = getParsedInputNumber(
    visibleCountInput,
    DEFAULT_VISIBLE_WINDOW_SIZE
  );
  const clamped = Math.max(1, Math.min(MAX_VISIBLE_WINDOW_SIZE, parsed));

  visibleCountInput.value = String(clamped);
  return clamped;
}

function setOffsetValue(offset) {
  offsetInput.value = String(offset);
  offsetValueElement.textContent = String(offset);
}

/**
 * @param {boolean} disabled
 */
function setActionButtonsDisabled(disabled) {
  for (let index = 0; index < actionButtons.length; index++) {
    const button = actionButtons[index];
    if (button == null) {
      continue;
    }

    button.disabled = disabled;
  }
}

/**
 * @param {PathStore} store
 * @param {number | undefined} [preferredOffset]
 * @returns {DemoViewContext}
 */
function getViewContext(store, preferredOffset = undefined) {
  const visibleCount = store.getVisibleCount();
  const requestedVisibleCount = getRequestedVisibleCount();
  const maxOffset = Math.max(0, visibleCount - requestedVisibleCount);
  const offset = Math.max(
    0,
    Math.min(maxOffset, preferredOffset ?? getParsedInputNumber(offsetInput, 0))
  );
  const bounds =
    visibleCount === 0
      ? { end: -1, start: 0 }
      : {
          end: Math.min(visibleCount - 1, offset + requestedVisibleCount - 1),
          start: offset,
        };
  const rows =
    visibleCount === 0 ? [] : store.getVisibleSlice(bounds.start, bounds.end);

  return {
    bounds,
    offset,
    requestedVisibleCount,
    rows,
    visibleCount,
  };
}

/**
 * @param {number | undefined} [preferredOffset]
 * @returns {DemoViewContext | null}
 */
/**
 * @param {number | undefined} [preferredOffset]
 * @param {DemoBenchmarkCollector | null | undefined} [benchmark]
 * @returns {DemoViewContext | null}
 */
function renderCurrentWindow(preferredOffset = undefined, benchmark = null) {
  if (currentStore == null) {
    rowsElement.textContent = '';
    offsetInput.disabled = true;
    offsetInput.max = '0';
    setOffsetValue(0);
    return null;
  }

  const view =
    benchmark == null
      ? getViewContext(currentStore, preferredOffset)
      : benchmark.instrumentation.measurePhase(
          'page.renderWindow.getViewContext',
          () => getViewContext(currentStore, preferredOffset)
        );
  const maxOffset = Math.max(0, view.visibleCount - view.requestedVisibleCount);

  offsetInput.disabled = false;
  offsetInput.max = String(maxOffset);
  setOffsetValue(view.offset);
  /** @type {string} */
  const rowsText =
    benchmark == null
      ? view.rows
          .map(
            /**
             * @param {PathStoreVisibleRow} row
             */
            (row) => formatVisibleRowText(row)
          )
          .join('\n')
      : benchmark.instrumentation.measurePhase(
          'page.renderWindow.joinRowsText',
          () =>
            view.rows
              .map(
                /**
                 * @param {PathStoreVisibleRow} row
                 */
                (row) => formatVisibleRowText(row)
              )
              .join('\n')
        );
  if (benchmark != null) {
    benchmark.instrumentation.setCounter(
      'workload.renderedRows',
      view.rows.length
    );
    benchmark.instrumentation.setCounter(
      'workload.totalVisibleRows',
      view.visibleCount
    );
  }
  if (benchmark == null) {
    rowsElement.textContent = rowsText;
  } else {
    benchmark.instrumentation.measurePhase(
      'page.renderWindow.setTextContent',
      () => {
        rowsElement.textContent = rowsText;
      }
    );
  }
  logDemoMessage(
    `Showing ${view.rows.length} visible paths starting at ${view.offset} out of ${view.visibleCount.toLocaleString()}.`
  );

  return view;
}

function getSelectedWorkloadSummary() {
  const workload = getSelectedWorkload();

  return {
    expandedFolderCount: workload.expandedFolders.length,
    fileCount: workload.files.length,
    flattenEmptyDirectories: getFlattenEmptyDirectoriesEnabled(),
    label: workload.label,
    name: workload.name,
    presortedInput: !getSortInputEnabled(),
  };
}

function formatVisibleRowText(row) {
  if (row.loadState == null) {
    return /** @type {string} */ (row.path);
  }

  return `${row.path} [${row.loadState}]`;
}

/**
 * @param {string} actionId
 * @returns {string}
 */
function getActionLabel(actionId) {
  if (actionId === 'render') {
    return 'Render';
  }

  const button = document.querySelector(`button[data-action-id="${actionId}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    return actionId;
  }

  const label = button.textContent?.trim();
  return label == null || label === '' ? actionId : label;
}

/**
 * Builds the page-level summary object that the Chrome profiler script reads
 * back after render or mutation work completes.
 *
 * @param {{
 *   actionId: string;
 *   afterView: DemoViewContext;
 *   beforeView?: DemoViewContext | null;
 *   detail: string;
 *   instrumentation?: DemoBenchmarkInstrumentationSummary | null;
 *   startedAt: number;
 *   visibleRowsReadyAt: number;
 * }} params
 */
function createPageProfileSummary({
  actionId,
  afterView,
  beforeView = null,
  detail,
  instrumentation = null,
  startedAt,
  visibleRowsReadyAt,
}) {
  const renderEndTime = performance.now();
  const renderLongTasks = longTaskEntries
    .map((entry) => ({
      ...entry,
      overlapMs: getTaskOverlapMs(entry, startedAt, renderEndTime),
    }))
    .filter((entry) => entry.overlapMs > 0);
  const longTaskCount = renderLongTasks.length;
  const longTaskTotalMs = renderLongTasks.reduce((total, entry) => {
    return total + entry.overlapMs;
  }, 0);
  const longestLongTaskMs = renderLongTasks.reduce((longest, entry) => {
    return Math.max(longest, entry.overlapMs);
  }, 0);
  const afterRows = afterView.rows.map(
    /**
     * @param {PathStoreVisibleRow} row
     */
    (row) => row.path
  );
  const beforeRows =
    beforeView?.rows.map(
      /**
       * @param {PathStoreVisibleRow} row
       */
      (row) => row.path
    ) ?? null;

  return {
    action: {
      id: actionId,
      label: getActionLabel(actionId),
    },
    afterRows,
    beforeRows,
    beforeVisibleCount: beforeView?.visibleCount ?? null,
    detail,
    longTaskCount,
    longTaskTotalMs,
    longestLongTaskMs,
    postPaintReadyMs: renderEndTime - startedAt,
    renderedRowCount: afterRows.length,
    requestedVisibleCount: afterView.requestedVisibleCount,
    resultText: `${detail}. Post-paint ready ${(renderEndTime - startedAt).toFixed(1)}ms. Visible rows ready ${(visibleRowsReadyAt - startedAt).toFixed(1)}ms. Rendered rows ${afterRows.length}. Long tasks ${longTaskCount}.`,
    instrumentation,
    visibleCount: afterView.visibleCount,
    visibleRowsReadyMs: visibleRowsReadyAt - startedAt,
    windowOffset: afterView.offset,
    workload: getSelectedWorkloadSummary(),
  };
}

/**
 * @param {string} path
 * @param {string} suffix
 * @returns {string}
 */
function renamePathWithSuffix(path, suffix) {
  const { isDirectory, name, parentPath } = splitPath(path);

  if (isDirectory) {
    return `${parentPath}${name}-${suffix}/`;
  }

  const extensionIndex = name.lastIndexOf('.');
  if (extensionIndex > 0) {
    return `${parentPath}${name.slice(0, extensionIndex)}-${suffix}${name.slice(extensionIndex)}`;
  }

  return `${parentPath}${name}-${suffix}`;
}

/**
 * Demo actions should prefer the current window, but they can fall back to a
 * broader visible-tree scan so the controls stay useful when the viewport is
 * temporarily all files.
 *
 * @param {PathStore} store
 * @param {DemoViewContext} view
 * @param {(row: PathStoreVisibleRow) => boolean} predicate
 * @returns {PathStoreVisibleRow | null}
 */
function findVisibleRow(store, view, predicate) {
  const localMatch = view.rows.find(predicate);
  if (localMatch != null) {
    return localMatch;
  }

  const visibleCount = store.getVisibleCount();

  for (
    let start = 0;
    start < visibleCount;
    start += VISIBLE_PATH_SEARCH_CHUNK_SIZE
  ) {
    const end = Math.min(
      visibleCount - 1,
      start + VISIBLE_PATH_SEARCH_CHUNK_SIZE - 1
    );
    const rows = store.getVisibleSlice(start, end);
    const match = rows.find(predicate);
    if (match != null) {
      return match;
    }
  }

  return null;
}

/**
 * @param {DemoViewContext} view
 * @param {string} actionId
 * @returns {PathStoreVisibleRow}
 */
function requireVisibleFolder(store, view, actionId) {
  const folder = findVisibleRow(store, view, (row) => row.kind === 'directory');
  if (folder == null) {
    throw new Error(`No visible folder found for ${actionId}.`);
  }

  return folder;
}

/**
 * @param {PathStore} store
 * @param {DemoViewContext} view
 * @param {string} actionId
 * @returns {PathStoreVisibleRow}
 */
function requireCollapsibleVisibleFolder(store, view, actionId) {
  const folder = findVisibleRow(
    store,
    view,
    (row) =>
      row.kind === 'directory' &&
      row.hasChildren === true &&
      row.isExpanded === true
  );
  if (folder == null) {
    throw new Error(`No expanded visible folder found for ${actionId}.`);
  }

  return folder;
}

/**
 * @param {PathStore} store
 * @param {DemoViewContext} view
 * @param {string} actionId
 * @returns {PathStoreVisibleRow}
 */
function requireExpandableVisibleFolder(store, view, actionId) {
  const folder = findVisibleRow(
    store,
    view,
    (row) =>
      row.kind === 'directory' &&
      row.hasChildren === true &&
      row.isExpanded === false
  );
  if (folder == null) {
    throw new Error(`No collapsed visible folder found for ${actionId}.`);
  }

  return folder;
}

/**
 * @param {PathStore} store
 * @param {DemoViewContext} view
 * @param {string} actionId
 * @returns {PathStoreVisibleRow}
 */
function requireVisibleLeaf(store, view, actionId) {
  const leaf = findVisibleRow(store, view, (row) => row.kind === 'file');
  if (leaf == null) {
    throw new Error(`No visible leaf file found for ${actionId}.`);
  }

  return leaf;
}

/**
 * Finds the last visible row before the current viewport whose predicate
 * passes, so offscreen actions can target the nearest item above the window.
 *
 * @param {PathStore} store
 * @param {number} beforeIndex
 * @param {(row: PathStoreVisibleRow) => boolean} predicate
 * @returns {PathStoreVisibleRow | null}
 */
function findVisibleRowBeforeIndex(store, beforeIndex, predicate) {
  if (beforeIndex <= 0) {
    return null;
  }

  for (
    let end = beforeIndex - 1;
    end >= 0;
    end -= VISIBLE_PATH_SEARCH_CHUNK_SIZE
  ) {
    const start = Math.max(0, end - VISIBLE_PATH_SEARCH_CHUNK_SIZE + 1);
    const rows = store.getVisibleSlice(start, end);

    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index];
      if (row != null && predicate(row)) {
        return row;
      }
    }
  }

  return null;
}

/**
 * @param {PathStore} store
 * @param {DemoViewContext} view
 * @param {string} actionId
 * @returns {PathStoreVisibleRow}
 */
function requireCollapsibleFolderAboveViewport(store, view, actionId) {
  const folder = findVisibleRowBeforeIndex(
    store,
    view.offset,
    (row) =>
      row.kind === 'directory' &&
      row.hasChildren === true &&
      row.isExpanded === true
  );
  if (folder == null) {
    throw new Error(`No expanded folder above the viewport for ${actionId}.`);
  }

  return folder;
}

/**
 * Finds the first visible directory whose move-to-parent destination does not
 * already exist, searching the current window first and then the wider tree.
 *
 * @param {PathStore} store
 * @param {DemoViewContext} view
 * @param {string} actionId
 * @returns {PathStoreVisibleRow}
 */
function requireVisibleFolderWithGrandparent(store, view, actionId) {
  const localMatch = findMoveVisibleFolderToParentCandidate(store, view.rows);
  if (localMatch != null) {
    return localMatch;
  }

  const visibleCount = store.getVisibleCount();

  for (
    let start = 0;
    start < visibleCount;
    start += VISIBLE_PATH_SEARCH_CHUNK_SIZE
  ) {
    const end = Math.min(
      visibleCount - 1,
      start + VISIBLE_PATH_SEARCH_CHUNK_SIZE - 1
    );
    const rows = store.getVisibleSlice(start, end);
    const match = findMoveVisibleFolderToParentCandidate(store, rows);
    if (match != null) {
      return match;
    }
  }

  throw new Error(
    `No visible folder with a moveable parent found for ${actionId}.`
  );
}

/**
 * Finds the first visible file whose move-to-parent destination does not
 * already exist, searching the current window first and then the wider tree.
 *
 * @param {PathStore} store
 * @param {DemoViewContext} view
 * @param {string} actionId
 * @returns {PathStoreVisibleRow}
 */
function requireVisibleLeafWithGrandparent(store, view, actionId) {
  const localMatch = findMoveVisibleLeafToParentCandidate(store, view.rows);
  if (localMatch != null) {
    return localMatch;
  }

  const visibleCount = store.getVisibleCount();

  for (
    let start = 0;
    start < visibleCount;
    start += VISIBLE_PATH_SEARCH_CHUNK_SIZE
  ) {
    const end = Math.min(
      visibleCount - 1,
      start + VISIBLE_PATH_SEARCH_CHUNK_SIZE - 1
    );
    const rows = store.getVisibleSlice(start, end);
    const match = findMoveVisibleLeafToParentCandidate(store, rows);
    if (match != null) {
      return match;
    }
  }

  throw new Error(
    `No visible leaf with a moveable parent found for ${actionId}.`
  );
}

/**
 * @param {PathStore} store
 * @param {string} targetPath
 * @returns {number | null}
 */
function findVisibleIndexByPath(store, targetPath) {
  const visibleCount = store.getVisibleCount();

  for (
    let start = 0;
    start < visibleCount;
    start += VISIBLE_PATH_SEARCH_CHUNK_SIZE
  ) {
    const end = Math.min(
      visibleCount - 1,
      start + VISIBLE_PATH_SEARCH_CHUNK_SIZE - 1
    );
    const rows = store.getVisibleSlice(start, end);

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (row != null && row.path === targetPath) {
        return start + index;
      }
    }
  }

  return null;
}

/**
 * @param {PathStore} store
 * @param {string} targetPath
 * @param {number} fallbackOffset
 * @param {number} windowSize
 * @returns {number}
 */
function getRevealOffset(store, targetPath, fallbackOffset, windowSize) {
  const visibleIndex = findVisibleIndexByPath(store, targetPath);
  if (visibleIndex == null) {
    return fallbackOffset;
  }

  const visibleCount = store.getVisibleCount();
  const maxOffset = Math.max(0, visibleCount - windowSize);
  const minOffset = Math.max(0, visibleIndex - windowSize + 1);
  const maxAllowedOffset = Math.min(visibleIndex, maxOffset);

  return Math.max(minOffset, Math.min(maxAllowedOffset, fallbackOffset));
}

function ensureAsyncDemoDirectory(store) {
  ensureAsyncDemoDirectories(store, [ASYNC_DEMO_DIRECTORY_PATH]);
}

/**
 * Marks the reset async placeholder directories as unloaded so either the raw
 * 7A controls or the cooperative helper can begin loading them immediately.
 *
 * @param {PathStore} store
 * @param {readonly string[]} directoryPaths
 */
function markDirectoriesUnloaded(store, directoryPaths) {
  for (const directoryPath of directoryPaths) {
    store.markDirectoryUnloaded(directoryPath);
  }
}

/**
 * Keeps async demo fixtures deterministic by clearing any previously loaded
 * subtree before re-adding the placeholder directories that the async actions
 * mutate.
 *
 * @param {PathStore} store
 * @param {readonly string[]} directoryPaths
 */
function ensureAsyncDemoDirectories(store, directoryPaths) {
  /** @type {string[]} */
  const canonicalPaths = store.list();
  for (const directoryPath of directoryPaths) {
    const hasDirectory = canonicalPaths.includes(directoryPath);
    const hasKnownChildren = canonicalPaths.some((path) =>
      path.startsWith(directoryPath)
    );

    if (hasKnownChildren) {
      store.remove(directoryPath, { recursive: true });
    } else if (hasDirectory) {
      store.remove(directoryPath);
    }

    store.add(directoryPath);
  }
}

/**
 * Schedulers are optional helpers, so the demo creates and disposes them on
 * demand around cooperative actions instead of wiring one into the store core.
 *
 * @param {DemoBenchmarkCollector | null | undefined} [benchmark]
 * @param {{
 *   chunkBudgetMs?: number;
 *   maxQueueSize?: number;
 *   maxTasksPerSlice?: number;
 *   yieldDelayMs?: number;
 * }} [overrides]
 */
function createDemoScheduler(benchmark = null, overrides = {}) {
  if (currentStore == null) {
    throw new Error('Render the store before creating a scheduler.');
  }

  const schedulerOptions =
    benchmark == null
      ? {
          ...overrides,
          store: currentStore,
        }
      : benchmark.attach({
          ...overrides,
          store: currentStore,
        });
  const scheduler = createPathStoreScheduler(schedulerOptions);
  subscribeToScheduler(scheduler);
  return scheduler;
}

/**
 * @param {readonly {
 *   completeOnSuccess?: boolean;
 *   createPatch: () => import('../src/public-types').PathStoreChildPatch | Promise<import('../src/public-types').PathStoreChildPatch>;
 *   path: string;
 *   priority: number;
 * }[]} tasks
 * @param {DemoBenchmarkCollector | null | undefined} [benchmark]
 * @param {{
 *   chunkBudgetMs?: number;
 *   maxQueueSize?: number;
 *   maxTasksPerSlice?: number;
 *   yieldDelayMs?: number;
 * }} [overrides]
 */
async function runCooperativeDemoTasks(
  tasks,
  benchmark = null,
  overrides = {}
) {
  const scheduler = createDemoScheduler(benchmark, overrides);
  const handles = tasks.map((task) => {
    const enqueueResult = scheduler.enqueue(task);
    if (enqueueResult.status === 'rejected') {
      throw new Error(
        `Scheduler rejected ${task.path}: ${enqueueResult.reason}`
      );
    }
    return enqueueResult.handle;
  });

  await scheduler.whenIdle();
  return {
    completions: await Promise.all(handles.map((handle) => handle.result)),
    metrics: scheduler.getMetrics(),
  };
}

function requireAsyncLoadAttempt(actionId) {
  if (currentAsyncLoadAttempt == null) {
    throw new Error(`No active async load attempt available for ${actionId}.`);
  }

  return currentAsyncLoadAttempt;
}

/** @type {readonly DemoAction[]} */
const demoActions = [
  {
    id: 'collapse-visible-folder',
    prepare(store, view) {
      const folder = requireCollapsibleVisibleFolder(store, view, this.id);
      return { path: folder.path };
    },
    run(store, prepared) {
      const path = /** @type {string} */ (prepared.path);
      store.collapse(path);
      return {
        detail: `Last action: collapsed ${path}`,
        revealPath: path,
      };
    },
  },
  {
    id: 'expand-visible-folder',
    prepare(store, view) {
      const folder = requireExpandableVisibleFolder(store, view, this.id);
      return { path: folder.path };
    },
    run(store, prepared) {
      const path = /** @type {string} */ (prepared.path);
      store.expand(path);
      return {
        detail: `Last action: expanded ${path}`,
        revealPath: path,
      };
    },
  },
  {
    id: 'rename-visible-folder',
    prepare(store, view) {
      const folder = requireVisibleFolder(store, view, this.id);
      return {
        from: folder.path,
        to: renamePathWithSuffix(folder.path, 'demo-renamed'),
      };
    },
    run(store, prepared) {
      const from = /** @type {string} */ (prepared.from);
      const to = /** @type {string} */ (prepared.to);
      store.move(from, to);
      return {
        detail: `Last action: renamed ${from} -> ${to}`,
        revealPath: to,
      };
    },
  },
  {
    id: 'delete-visible-folder',
    prepare(store, view) {
      const folder = requireVisibleFolder(store, view, this.id);
      return { path: folder.path };
    },
    run(store, prepared) {
      const path = /** @type {string} */ (prepared.path);
      store.remove(path, { recursive: true });
      return {
        detail: `Last action: deleted ${path}`,
      };
    },
  },
  {
    id: 'rename-visible-leaf',
    prepare(store, view) {
      const leaf = requireVisibleLeaf(store, view, this.id);
      return {
        from: leaf.path,
        to: renamePathWithSuffix(leaf.path, 'demo-renamed'),
      };
    },
    run(store, prepared) {
      const from = /** @type {string} */ (prepared.from);
      const to = /** @type {string} */ (prepared.to);
      store.move(from, to);
      return {
        detail: `Last action: renamed ${from} -> ${to}`,
        revealPath: to,
      };
    },
  },
  {
    id: 'delete-visible-leaf',
    prepare(store, view) {
      const leaf = requireVisibleLeaf(store, view, this.id);
      return { path: leaf.path };
    },
    run(store, prepared) {
      const path = /** @type {string} */ (prepared.path);
      store.remove(path);
      return {
        detail: `Last action: deleted ${path}`,
      };
    },
  },
  {
    id: 'move-visible-folder-to-parent',
    prepare(store, view) {
      const source = requireVisibleFolderWithGrandparent(store, view, this.id);
      const movePlan = getMoveVisibleFolderToParentPlan(store, source.path);
      if (movePlan == null) {
        throw new Error(`No non-colliding move target found for ${this.id}.`);
      }

      return {
        destinationPath: movePlan.destinationPath,
        from: source.path,
        movedPath: movePlan.movedPath,
      };
    },
    run(store, prepared) {
      const destinationPath = /** @type {string} */ (prepared.destinationPath);
      const from = /** @type {string} */ (prepared.from);
      const movedPath = /** @type {string} */ (prepared.movedPath);
      store.move(from, destinationPath);
      return {
        detail: `Last action: moved ${from} to parent ${destinationPath}`,
        revealPath: movedPath,
      };
    },
  },
  {
    id: 'move-visible-leaf-to-parent',
    prepare(store, view) {
      const source = requireVisibleLeafWithGrandparent(store, view, this.id);
      const movePlan = getMovePathToParentPlan(store, source.path);
      if (movePlan == null) {
        throw new Error(`No non-colliding move target found for ${this.id}.`);
      }

      return {
        destinationPath: movePlan.destinationPath,
        from: source.path,
        movedPath: movePlan.movedPath,
      };
    },
    run(store, prepared) {
      const destinationPath = /** @type {string} */ (prepared.destinationPath);
      const from = /** @type {string} */ (prepared.from);
      const movedPath = /** @type {string} */ (prepared.movedPath);
      store.move(from, destinationPath);
      return {
        detail: `Last action: moved ${from} to parent ${destinationPath}`,
        revealPath: movedPath,
      };
    },
  },
  {
    id: 'collapse-folder-above-viewport',
    prepare(store, view) {
      const folder = requireCollapsibleFolderAboveViewport(
        store,
        view,
        this.id
      );
      return { path: folder.path };
    },
    run(store, prepared) {
      const path = /** @type {string} */ (prepared.path);
      store.collapse(path);
      return {
        detail: `Last action: collapsed above viewport ${path}`,
      };
    },
  },
  {
    id: 'begin-async-load',
    prepare() {
      return {};
    },
    run(store) {
      ensureAsyncDemoDirectory(store);
      store.markDirectoryUnloaded(ASYNC_DEMO_DIRECTORY_PATH);
      currentAsyncLoadAttempt = store.beginChildLoad(ASYNC_DEMO_DIRECTORY_PATH);
      return {
        detail: `Last action: began async load for ${ASYNC_DEMO_DIRECTORY_PATH}`,
        revealPath: ASYNC_DEMO_DIRECTORY_PATH,
      };
    },
  },
  {
    id: 'apply-async-patch',
    prepare() {
      return {};
    },
    run(store) {
      const attempt = requireAsyncLoadAttempt(this.id);
      const applied = store.applyChildPatch(attempt, {
        operations: [{ path: ASYNC_DEMO_PATCH_FILE_PATH, type: 'add' }],
      });
      if (!applied) {
        throw new Error(`Async child patch was stale for ${this.id}.`);
      }

      return {
        detail: `Last action: applied async child patch to ${ASYNC_DEMO_DIRECTORY_PATH}`,
        revealPath: ASYNC_DEMO_PATCH_FILE_PATH,
      };
    },
  },
  {
    id: 'complete-async-load',
    prepare() {
      return {};
    },
    run(store) {
      const attempt = requireAsyncLoadAttempt(this.id);
      const completed = store.completeChildLoad(attempt);
      currentAsyncLoadAttempt = null;
      if (!completed) {
        throw new Error(`Async load completion was stale for ${this.id}.`);
      }

      return {
        detail: `Last action: completed async load for ${ASYNC_DEMO_DIRECTORY_PATH}`,
        revealPath: ASYNC_DEMO_DIRECTORY_PATH,
      };
    },
  },
  {
    id: 'fail-async-load',
    prepare() {
      return {};
    },
    run(store) {
      const attempt = requireAsyncLoadAttempt(this.id);
      const failed = store.failChildLoad(attempt, 'demo failure');
      currentAsyncLoadAttempt = null;
      if (!failed) {
        throw new Error(`Async load failure was stale for ${this.id}.`);
      }

      return {
        detail: `Last action: failed async load for ${ASYNC_DEMO_DIRECTORY_PATH}`,
        revealPath: ASYNC_DEMO_DIRECTORY_PATH,
      };
    },
  },
  {
    id: 'cooperative-apply-async-patch',
    prepare() {
      return {};
    },
    async run(store, _prepared, benchmark = null) {
      ensureAsyncDemoDirectory(store);
      markDirectoriesUnloaded(store, [ASYNC_DEMO_DIRECTORY_PATH]);
      const { completions } = await runCooperativeDemoTasks(
        [
          {
            completeOnSuccess: false,
            createPatch() {
              return {
                operations: [{ path: ASYNC_DEMO_PATCH_FILE_PATH, type: 'add' }],
              };
            },
            path: ASYNC_DEMO_DIRECTORY_PATH,
            priority: 100,
          },
        ],
        benchmark
      );
      const completion = completions[0];
      if (completion == null || completion.status !== 'completed') {
        throw new Error(
          `Cooperative async patch did not complete successfully for ${ASYNC_DEMO_DIRECTORY_PATH}.`
        );
      }

      return {
        detail: `Last action: cooperatively applied async patch to ${ASYNC_DEMO_DIRECTORY_PATH}`,
        revealPath: ASYNC_DEMO_PATCH_FILE_PATH,
      };
    },
  },
  {
    id: 'cooperative-apply-async-patch-yieldy',
    prepare() {
      return {};
    },
    async run(store, _prepared, benchmark = null) {
      ensureAsyncDemoDirectories(store, COOPERATIVE_ASYNC_DEMO_DIRECTORY_PATHS);
      markDirectoriesUnloaded(store, COOPERATIVE_ASYNC_DEMO_DIRECTORY_PATHS);

      const { completions, metrics } = await runCooperativeDemoTasks(
        COOPERATIVE_ASYNC_DEMO_DIRECTORY_PATHS.map((directoryPath, index) => {
          const patchFilePath = COOPERATIVE_ASYNC_DEMO_PATCH_FILE_PATHS[index];
          if (patchFilePath == null) {
            throw new Error('Missing cooperative demo patch path.');
          }

          return {
            completeOnSuccess: false,
            createPatch() {
              return {
                operations: [{ path: patchFilePath, type: 'add' }],
              };
            },
            path: directoryPath,
            priority: 100 - index,
          };
        }),
        benchmark,
        {
          chunkBudgetMs: 0,
          maxTasksPerSlice: 1,
          yieldDelayMs: 16,
        }
      );

      const failedCompletion = completions.find(
        (completion) => completion.status !== 'completed'
      );
      if (failedCompletion != null) {
        throw new Error(
          `Cooperative yieldy async patch failed for ${failedCompletion.path}.`
        );
      }
      if (metrics.yieldCount <= 1) {
        throw new Error(
          `Expected cooperative yieldy async patch to yield more than once, received ${metrics.yieldCount}.`
        );
      }

      return {
        detail: `Last action: cooperatively applied ${completions.length} async patches across ${metrics.yieldCount} yields`,
        revealPath: COOPERATIVE_ASYNC_DEMO_PATCH_FILE_PATHS[0],
      };
    },
  },
];

const demoActionById = new Map(
  demoActions.map((action) => [action.id, action])
);

/**
 * @param {DemoBenchmarkCollector | null | undefined} [benchmark]
 */
function createStore(benchmark = null) {
  const workload = getSelectedWorkload();
  const flattenEmptyDirectories = getFlattenEmptyDirectoriesEnabled();
  const sortInput = getSortInputEnabled();
  const buildStartedAt = performance.now();
  clearSchedulerState();
  let preparedInput = null;
  if (!sortInput) {
    preparedInput =
      benchmark == null
        ? PathStore.preparePresortedInput(workload.presortedFiles)
        : benchmark.instrumentation.measurePhase(
            'page.preparePresortedInput',
            () => PathStore.preparePresortedInput(workload.presortedFiles)
          );
  }
  const storeOptions =
    benchmark == null
      ? preparedInput == null
        ? {
            flattenEmptyDirectories,
            initialExpansion: 'open',
            paths: workload.files,
          }
        : {
            flattenEmptyDirectories,
            initialExpansion: 'open',
            preparedInput,
          }
      : benchmark.attach(
          preparedInput == null
            ? {
                flattenEmptyDirectories,
                initialExpansion: 'open',
                paths: workload.files,
              }
            : {
                flattenEmptyDirectories,
                initialExpansion: 'open',
                preparedInput,
              }
        );
  if (benchmark != null) {
    benchmark.instrumentation.setCounter(
      'workload.inputFiles',
      workload.files.length
    );
    benchmark.instrumentation.setCounter(
      'workload.expandedFolders',
      workload.expandedFolders.length
    );
  }
  currentStore =
    benchmark == null
      ? new PathStore(storeOptions)
      : benchmark.instrumentation.measurePhase(
          'page.createStore',
          () => new PathStore(storeOptions)
        );
  buildTimeMs = performance.now() - buildStartedAt;
  currentAsyncLoadAttempt = null;
  clearLastEvent();
  subscribeToStoreEvents(currentStore);
  const visibleRowCount =
    benchmark == null ? currentStore.getVisibleCount().toLocaleString() : null;
  logDemoMessage(
    visibleRowCount == null
      ? `Loaded ${workload.label} in ${buildTimeMs.toFixed(1)}ms.`
      : `Loaded ${workload.label} in ${buildTimeMs.toFixed(1)}ms with ${visibleRowCount} visible rows.`
  );

  window.pathStoreDemo = {
    ...window.pathStoreDemo,
    store: currentStore,
    workload,
  };
}

function renderStoreForSetup(preferredOffset = undefined) {
  createStore();
  return renderCurrentWindow(preferredOffset);
}

async function profileRenderStore() {
  renderButton.disabled = true;
  setActionButtonsDisabled(true);
  clearProfileSummary();
  const benchmark = await createBenchmarkCollector();
  warmPresortedFilesIfNeeded();

  const startedAt = performance.now();
  const heapBefore = benchmark?.readHeapSnapshot() ?? null;
  performance.mark(PROFILE_START_MARK_NAME);
  console.timeStamp(PROFILE_START_LABEL);

  try {
    createStore(benchmark);
    const afterView =
      benchmark == null
        ? renderCurrentWindow(0)
        : benchmark.instrumentation.measurePhase('page.renderWindow', () =>
            renderCurrentWindow(0, benchmark)
          );
    if (afterView == null) {
      throw new Error('Failed to render the store.');
    }

    const visibleRowsReadyAt = performance.now();
    await waitForPaint();
    const heapAfter = benchmark?.readHeapSnapshot() ?? null;
    performance.mark(PROFILE_END_MARK_NAME);
    console.timeStamp(PROFILE_END_LABEL);

    const profile = createPageProfileSummary({
      actionId: 'render',
      afterView,
      detail: `Rendered ${getSelectedWorkloadSummary().label}`,
      instrumentation: benchmark?.summarize(heapBefore, heapAfter) ?? null,
      startedAt,
      visibleRowsReadyAt,
    });

    window.__pathStoreDemoProfile = profile;
    return profile;
  } finally {
    renderButton.disabled = false;
    setActionButtonsDisabled(currentStore == null);
  }
}

async function boot() {
  renderButton.disabled = true;
  setActionButtonsDisabled(true);
  logDemoMessage(`Rendering ${getSelectedWorkload().name}…`);

  try {
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    createStore();
    setOffsetValue(0);
    renderCurrentWindow(0);
  } catch (error) {
    logDemoMessage(
      error instanceof Error ? error.message : 'Failed to render demo.'
    );
    throw error;
  } finally {
    renderButton.disabled = false;
    setActionButtonsDisabled(currentStore == null);
  }
}

/**
 * @param {string} actionId
 * @returns {PreparedDemoAction}
 */
function prepareAction(actionId) {
  if (currentStore == null) {
    throw new Error('Render the store before running demo actions.');
  }

  const action = demoActionById.get(actionId);
  if (action == null) {
    throw new Error(`Unknown demo action: ${actionId}`);
  }

  const view = getViewContext(currentStore);
  return {
    action,
    prepared: action.prepare(currentStore, view),
    view,
  };
}

function prepareProfileAction(actionId) {
  applyProfileActionSetup(actionId);
  return prepareAction(actionId).prepared;
}

/**
 * Some profiled demo actions need untimed setup so they have a meaningful
 * target. This runs before tracing starts and only adjusts the demo state
 * enough to make the requested action available.
 *
 * @param {string} actionId
 */
function applyProfileActionSetup(actionId) {
  if (currentStore == null) {
    throw new Error('Render the store before preparing profile actions.');
  }

  if (actionId === 'expand-visible-folder') {
    const view = getViewContext(currentStore);
    try {
      requireExpandableVisibleFolder(currentStore, view, actionId);
      return;
    } catch {
      const folder = requireCollapsibleVisibleFolder(
        currentStore,
        view,
        actionId
      );
      currentStore.collapse(folder.path);
      renderCurrentWindow(view.offset);
      return;
    }
  }

  if (actionId === 'collapse-folder-above-viewport') {
    const currentView = getViewContext(currentStore);
    const visibleCount = currentStore.getVisibleCount();
    const targetOffset =
      currentView.offset > 0
        ? currentView.offset
        : Math.min(
            Math.max(1, currentView.requestedVisibleCount),
            Math.max(1, visibleCount - 1)
          );
    renderCurrentWindow(targetOffset);
    return;
  }

  if (
    actionId === 'apply-async-patch' ||
    actionId === 'complete-async-load' ||
    actionId === 'fail-async-load'
  ) {
    ensureAsyncDemoDirectory(currentStore);
    currentStore.markDirectoryUnloaded(ASYNC_DEMO_DIRECTORY_PATH);
    currentAsyncLoadAttempt = currentStore.beginChildLoad(
      ASYNC_DEMO_DIRECTORY_PATH
    );
    renderCurrentWindow(0);
    return;
  }

  if (actionId === 'cooperative-apply-async-patch') {
    ensureAsyncDemoDirectory(currentStore);
    markDirectoriesUnloaded(currentStore, [ASYNC_DEMO_DIRECTORY_PATH]);
    clearSchedulerState();
    renderCurrentWindow(0);
    return;
  }

  if (actionId === 'cooperative-apply-async-patch-yieldy') {
    ensureAsyncDemoDirectories(
      currentStore,
      COOPERATIVE_ASYNC_DEMO_DIRECTORY_PATHS
    );
    markDirectoriesUnloaded(
      currentStore,
      COOPERATIVE_ASYNC_DEMO_DIRECTORY_PATHS
    );
    clearSchedulerState();
    renderCurrentWindow(0);
  }
}

/**
 * @param {PreparedDemoAction} preparedAction
 * @returns {Promise<DemoActionResult>}
 */
async function runPreparedAction(preparedAction) {
  return (await runPreparedActionWithBenchmark(preparedAction, null))
    .actionResult;
}

/**
 * Runs a prepared action and then rerenders the relevant window, optionally
 * recording nested benchmark phases for the profile collector.
 *
 * @param {PreparedDemoAction} preparedAction
 * @param {DemoBenchmarkCollector | null | undefined} [benchmark]
 * @returns {Promise<{ actionResult: DemoActionResult; afterView: DemoViewContext | null }>}
 */
async function runPreparedActionWithBenchmark(
  preparedAction,
  benchmark = null
) {
  if (currentStore == null) {
    throw new Error('Render the store before running demo actions.');
  }

  const startedAt = performance.now();
  const actionResult =
    benchmark == null
      ? await preparedAction.action.run(
          currentStore,
          preparedAction.prepared,
          null
        )
      : await benchmark.instrumentation.measurePhase('page.action.run', () =>
          preparedAction.action.run(
            currentStore,
            preparedAction.prepared,
            benchmark
          )
        );
  const preferredOffset =
    actionResult.revealPath == null
      ? preparedAction.view.offset
      : getRevealOffset(
          currentStore,
          actionResult.revealPath,
          preparedAction.view.offset,
          preparedAction.view.requestedVisibleCount
        );

  logDemoMessage(
    `${actionResult.detail} in ${(performance.now() - startedAt).toFixed(1)}ms.`
  );
  const afterView =
    benchmark == null
      ? renderCurrentWindow(preferredOffset)
      : benchmark.instrumentation.measurePhase('page.action.renderWindow', () =>
          renderCurrentWindow(preferredOffset, benchmark)
        );

  return {
    actionResult,
    afterView,
  };
}

async function profilePreparedAction(actionId, prepared) {
  const action = demoActionById.get(actionId);
  if (action == null) {
    throw new Error(`Unknown demo action: ${actionId}`);
  }

  const benchmark = await createBenchmarkCollector();
  warmPresortedFilesIfNeeded();
  const demoState = {
    flattenEmptyDirectories: getFlattenEmptyDirectoriesEnabled(),
    offset: getParsedInputNumber(offsetInput, 0),
    visibleCount: getRequestedVisibleCount(),
    workloadName: getSelectedWorkloadName(),
  };

  configureDemo(demoState);
  createStore(benchmark);
  renderCurrentWindow(demoState.offset, benchmark);
  applyProfileActionSetup(actionId);

  if (currentStore == null) {
    throw new Error('Render the store before running demo actions.');
  }

  const beforeView = getViewContext(currentStore);
  const preparedAction = {
    action,
    prepared: prepared ?? action.prepare(currentStore, beforeView),
    view: beforeView,
  };

  clearProfileSummary();
  benchmark?.reset();
  const startedAt = performance.now();
  const heapBefore = benchmark?.readHeapSnapshot() ?? null;
  performance.mark(PROFILE_START_MARK_NAME);
  console.timeStamp(PROFILE_START_LABEL);

  const { actionResult, afterView } = await runPreparedActionWithBenchmark(
    preparedAction,
    benchmark
  );
  if (afterView == null) {
    throw new Error('Failed to rerender the window after the action.');
  }
  const visibleRowsReadyAt = performance.now();
  await waitForPaint();
  const heapAfter = benchmark?.readHeapSnapshot() ?? null;
  performance.mark(PROFILE_END_MARK_NAME);
  console.timeStamp(PROFILE_END_LABEL);

  const profile = createPageProfileSummary({
    actionId,
    afterView,
    beforeView,
    detail: actionResult.detail,
    instrumentation: benchmark?.summarize(heapBefore, heapAfter) ?? null,
    startedAt,
    visibleRowsReadyAt,
  });

  window.__pathStoreDemoProfile = profile;
  return profile;
}

function configureDemo({
  flattenEmptyDirectories,
  offset,
  sortInputEnabled,
  visibleCount,
  workloadName,
}) {
  if (typeof workloadName === 'string' && workloadName !== '') {
    workloadInput.value = workloadName;
  }

  if (typeof flattenEmptyDirectories === 'boolean') {
    flattenInput.checked = flattenEmptyDirectories;
  }

  if (typeof sortInputEnabled === 'boolean') {
    sortInput.checked = sortInputEnabled;
  }

  if (Number.isFinite(visibleCount)) {
    visibleCountInput.value = String(
      Math.max(1, Math.min(MAX_VISIBLE_WINDOW_SIZE, Math.trunc(visibleCount)))
    );
  }

  if (Number.isFinite(offset)) {
    setOffsetValue(Math.max(0, Math.trunc(offset)));
  }

  return {
    flattenEmptyDirectories: getFlattenEmptyDirectoriesEnabled(),
    offset: getParsedInputNumber(offsetInput, 0),
    sortInputEnabled: getSortInputEnabled(),
    visibleCount: getRequestedVisibleCount(),
    workloadName: getSelectedWorkloadName(),
  };
}

function getDemoState() {
  return {
    flattenEmptyDirectories: getFlattenEmptyDirectoriesEnabled(),
    hasStore: currentStore != null,
    lastEvent,
    offset: getParsedInputNumber(offsetInput, 0),
    schedulerMetrics: currentSchedulerMetrics,
    schedulerUpdateCount,
    sortInputEnabled: getSortInputEnabled(),
    visibleCount: getRequestedVisibleCount(),
    workload: getSelectedWorkloadSummary(),
  };
}

renderButton.addEventListener('click', () => {
  void boot();
});

visibleCountInput.addEventListener('input', () => {
  renderCurrentWindow();
});

flattenInput.addEventListener('input', () => {
  if (currentStore == null) {
    return;
  }

  const currentOffset = getParsedInputNumber(offsetInput, 0);
  createStore();
  renderCurrentWindow(currentOffset);
});

sortInput.addEventListener('input', () => {
  if (currentStore == null) {
    return;
  }

  const currentOffset = getParsedInputNumber(offsetInput, 0);
  createStore();
  renderCurrentWindow(currentOffset);
});

offsetInput.addEventListener('input', () => {
  setOffsetValue(getParsedInputNumber(offsetInput, 0));
  renderCurrentWindow();
});

for (let index = 0; index < actionButtons.length; index++) {
  const button = actionButtons[index];
  if (button == null) {
    continue;
  }

  button.addEventListener('click', () => {
    void (async () => {
      if (button.dataset.actionId === 'reset') {
        await boot();
        return;
      }

      renderButton.disabled = true;
      setActionButtonsDisabled(true);

      try {
        const preparedAction = prepareAction(button.dataset.actionId ?? '');
        await runPreparedAction(preparedAction);
      } catch (error) {
        logDemoMessage(
          error instanceof Error
            ? `Last action failed: ${error.message}`
            : 'Last action failed.'
        );
        renderCurrentWindow();
        throw error;
      } finally {
        renderButton.disabled = false;
        setActionButtonsDisabled(currentStore == null);
      }
    })();
  });
}

window.pathStoreDemo = {
  configureDemo,
  getState: getDemoState,
  prepareAction,
  prepareProfileAction,
  profilePreparedAction,
  profileRenderStore,
  renderStoreForSetup,
  runPreparedAction,
  getLastEvent: () => lastEvent,
  store: currentStore,
  workload: null,
};
window.__pathStoreDemoFixtureReady = true;
