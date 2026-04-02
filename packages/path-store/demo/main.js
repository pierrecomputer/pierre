import { getVirtualizationWorkload } from '@pierre/tree-test-data';

import { PathStore } from '../src/index.ts';

const MAX_VISIBLE_WINDOW_SIZE = 500;
const DEFAULT_VISIBLE_WINDOW_SIZE = 30;

/**
 * @typedef {import('../src/public-types').PathStoreVisibleRow} PathStoreVisibleRow
 */

const visibleCountInput = document.querySelector('#visible-count');
const offsetInput = document.querySelector('#offset');
const offsetValueElement = document.querySelector('#offset-value');
const renderButton = document.querySelector('#render-button');
const statusElement = document.querySelector('#status');
const rowsElement = document.querySelector('#rows');

if (
  visibleCountInput == null ||
  offsetInput == null ||
  offsetValueElement == null ||
  renderButton == null ||
  statusElement == null ||
  rowsElement == null
) {
  throw new Error('Missing demo root elements.');
}

const workload = getVirtualizationWorkload('linux-5x');

let buildTimeMs = 0;
/** @type {PathStore | null} */
let currentStore = null;

/**
 * @param {HTMLInputElement} input
 * @param {number} fallbackValue
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

function renderCurrentWindow() {
  if (currentStore == null) {
    rowsElement.textContent = '';
    statusElement.textContent = 'Ready to load linux-5x.';
    return;
  }

  const visibleCount = currentStore.getVisibleCount();
  const requestedVisibleCount = getRequestedVisibleCount();
  const maxOffset = Math.max(0, visibleCount - requestedVisibleCount);
  const offset = Math.max(
    0,
    Math.min(maxOffset, getParsedInputNumber(offsetInput, 0))
  );
  const rows =
    visibleCount === 0
      ? []
      : currentStore.getVisibleSlice(
          offset,
          Math.min(visibleCount - 1, offset + requestedVisibleCount - 1)
        );

  offsetInput.disabled = false;
  offsetInput.max = String(maxOffset);
  setOffsetValue(offset);
  rowsElement.textContent = rows
    .map(
      /**
       * @param {PathStoreVisibleRow} row
       */
      (row) => row.path
    )
    .join('\n');
  statusElement.textContent =
    `Loaded ${workload.label} in ${buildTimeMs.toFixed(1)}ms. ` +
    `Showing ${rows.length} visible paths starting at ${offset} out of ` +
    `${visibleCount.toLocaleString()}.`;
}

async function boot() {
  renderButton.disabled = true;
  statusElement.textContent = 'Rendering linux-5x…';

  try {
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    const buildStartedAt = performance.now();
    currentStore = new PathStore({
      initialExpansion: 'open',
      paths: workload.files,
    });
    buildTimeMs = performance.now() - buildStartedAt;

    window.pathStoreDemo = {
      store: currentStore,
      workload,
    };

    renderCurrentWindow();
  } catch (error) {
    statusElement.textContent =
      error instanceof Error ? error.message : 'Failed to render demo.';
    throw error;
  } finally {
    renderButton.disabled = false;
  }
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
