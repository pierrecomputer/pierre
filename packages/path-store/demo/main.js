import { getVirtualizationWorkload } from '@pierre/tree-test-data';

import { PathStore } from '../src/index.ts';
import {
  findMoveVisibleFolderToParentCandidate,
  getMoveVisibleFolderToParentPlan,
  splitPath,
} from './helpers.js';

const DEFAULT_WORKLOAD_NAME = 'linux-5x';
const MAX_VISIBLE_WINDOW_SIZE = 500;
const DEFAULT_VISIBLE_WINDOW_SIZE = 30;
const VISIBLE_PATH_SEARCH_CHUNK_SIZE = 512;

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
 *   run: (store: PathStore, prepared: Record<string, unknown>) => DemoActionResult;
 * }} DemoAction
 */

/**
 * @typedef {{
 *   action: DemoAction;
 *   prepared: Record<string, unknown>;
 *   view: DemoViewContext;
 * }} PreparedDemoAction
 */

const actionButtons = document.querySelectorAll('button[data-action-id]');
const visibleCountInput = document.querySelector('#visible-count');
const offsetInput = document.querySelector('#offset');
const offsetValueElement = document.querySelector('#offset-value');
const renderButton = document.querySelector('#render-button');
const rowsElement = document.querySelector('#rows');
const workloadInput = document.querySelector('#workload');

if (
  visibleCountInput == null ||
  offsetInput == null ||
  offsetValueElement == null ||
  renderButton == null ||
  rowsElement == null ||
  workloadInput == null
) {
  throw new Error('Missing demo root elements.');
}

let buildTimeMs = 0;
/** @type {PathStore | null} */
let currentStore = null;

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

function logDemoMessage(message) {
  console.info(`[path-store demo] ${message}`);
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
function renderCurrentWindow(preferredOffset = undefined) {
  if (currentStore == null) {
    rowsElement.textContent = '';
    offsetInput.disabled = true;
    offsetInput.max = '0';
    setOffsetValue(0);
    return null;
  }

  const view = getViewContext(currentStore, preferredOffset);
  const maxOffset = Math.max(0, view.visibleCount - view.requestedVisibleCount);

  offsetInput.disabled = false;
  offsetInput.max = String(maxOffset);
  setOffsetValue(view.offset);
  rowsElement.textContent = view.rows
    .map(
      /**
       * @param {PathStoreVisibleRow} row
       */
      (row) => row.path
    )
    .join('\n');
  logDemoMessage(
    `Showing ${view.rows.length} visible paths starting at ${view.offset} out of ${view.visibleCount.toLocaleString()}.`
  );

  return view;
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
function requireVisibleLeaf(store, view, actionId) {
  const leaf = findVisibleRow(store, view, (row) => row.kind === 'file');
  if (leaf == null) {
    throw new Error(`No visible leaf file found for ${actionId}.`);
  }

  return leaf;
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
];

const demoActionById = new Map(
  demoActions.map((action) => [action.id, action])
);

function createStore() {
  const workload = getSelectedWorkload();
  const buildStartedAt = performance.now();
  currentStore = new PathStore({
    initialExpansion: 'open',
    paths: workload.files,
  });
  buildTimeMs = performance.now() - buildStartedAt;
  logDemoMessage(
    `Loaded ${workload.label} in ${buildTimeMs.toFixed(1)}ms with ${currentStore.getVisibleCount().toLocaleString()} visible rows.`
  );

  window.pathStoreDemo = {
    prepareAction,
    runPreparedAction,
    store: currentStore,
    workload,
  };
}

async function boot() {
  renderButton.disabled = true;
  setActionButtonsDisabled(true);
  logDemoMessage('Rendering linux-5x…');

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

/**
 * @param {PreparedDemoAction} preparedAction
 * @returns {DemoActionResult}
 */
function runPreparedAction(preparedAction) {
  if (currentStore == null) {
    throw new Error('Render the store before running demo actions.');
  }

  const startedAt = performance.now();
  const actionResult = preparedAction.action.run(
    currentStore,
    preparedAction.prepared
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
  renderCurrentWindow(preferredOffset);

  return actionResult;
}

renderButton.addEventListener('click', () => {
  void boot();
});

visibleCountInput.addEventListener('input', () => {
  renderCurrentWindow();
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
    if (button.dataset.actionId === 'reset') {
      void boot();
      return;
    }

    try {
      const preparedAction = prepareAction(button.dataset.actionId ?? '');
      runPreparedAction(preparedAction);
    } catch (error) {
      logDemoMessage(
        error instanceof Error
          ? `Last action failed: ${error.message}`
          : 'Last action failed.'
      );
      renderCurrentWindow();
      throw error;
    }
  });
}
