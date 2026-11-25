import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import type { LanguageRegistration, ThemeRegistration } from 'shiki';

import { CodeView } from '../src/components/CodeView';
import { RegisteredCustomLanguages } from '../src/highlighter/languages/constants';
import { registerCustomLanguage } from '../src/highlighter/languages/registerCustomLanguage';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { registerCustomTheme } from '../src/highlighter/themes/registerCustomTheme';
import { customThemes } from '../src/highlighter/themes/themeResolver';
import type { CodeViewItem, DiffsHighlighter } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import type {
  WorkerInitializationRenderOptions,
  WorkerPoolOptions,
} from '../src/worker/types';
import { WorkerPoolManager } from '../src/worker/WorkerPoolManager';
import { createRoot, installDom, wait, waitFor } from './domHarness';
import { assertDefined, createDeferred } from './testUtils';
import { TestWorker, withTimeout } from './workerPoolHarness';

const LINE = 'const answer = 42;';
const original = {
  name: 'answer.ts',
  contents: 'const answer = 0;\n',
  cacheKey: 'ready:old',
};
const updated = { ...original, contents: `${LINE}\n`, cacheKey: 'ready:new' };
const items: CodeViewItem<undefined>[] = [
  { id: 'file', type: 'file', file: updated },
  { id: 'diff', type: 'diff', fileDiff: parseDiffFromFile(original, updated) },
];

let highlighter: DiffsHighlighter;
let dom: ReturnType<typeof installDom>;
const teardown: (() => void)[] = [];

beforeAll(async () => {
  highlighter = await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});
afterAll(disposeHighlighter);
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  for (const fn of teardown.splice(0).reverse()) fn();
  dom.cleanup();
  mock.restore();
});

// A real pool. Its constructor starts it right away, so a worker may exist
// before the test does anything. Each worker is a TestWorker whose replies the
// test controls.
function createPool(
  poolOptions: Partial<WorkerPoolOptions> = {},
  renderOptions: Partial<WorkerInitializationRenderOptions> = {}
) {
  const workers: TestWorker[] = [];
  const workerFactory = () => {
    const worker = new TestWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  };
  const manager = new WorkerPoolManager(
    { poolSize: 1, workerFactory, ...poolOptions },
    {
      theme: 'pierre-dark',
      langs: [],
      preferredHighlighter: 'shiki-js',
      lineDiffType: 'none',
      ...renderOptions,
    }
  );
  teardown.push(() => manager.terminate());
  return { manager, workers };
}

// Waits for a worker the pool has not retired to request initialization.
async function waitForLiveWorker(workers: TestWorker[]): Promise<TestWorker> {
  await waitFor(() => workers.some((worker) => !worker.terminated));
  const worker = workers.find(({ terminated }) => !terminated);
  assertDefined(worker, 'Expected the pool to start a worker');
  await withTimeout(worker.waitForInitializeRequest());
  return worker;
}

async function acknowledgeInitialize(worker: TestWorker): Promise<void> {
  const request = await withTimeout(worker.waitForInitializeRequest());
  worker.respond({
    type: 'success',
    requestType: 'initialize',
    id: request.id,
    sentAt: Date.now(),
  });
}

function mount(manager: WorkerPoolManager): CodeView<undefined> {
  const viewer = new CodeView<undefined>(
    { disableFileHeader: true, stickyHeaders: false, diffStyle: 'unified' },
    manager
  );
  viewer.setup(createRoot());
  teardown.push(() => viewer.cleanUp());
  return viewer;
}

// The changed line of each rendered item: the file's line and the diff's
// addition.
function changedLines(
  viewer: CodeView<undefined>
): (Element | null | undefined)[] {
  return viewer
    .getRenderedItems()
    .map(({ type, element }) =>
      element.shadowRoot?.querySelector(
        type === 'file'
          ? '[data-line="1"]'
          : '[data-line-type="change-addition"][data-line]'
      )
    );
}

function spanTexts(line: Element | null | undefined): (string | null)[] {
  return line == null
    ? []
    : Array.from(line.children, (span) => span.textContent);
}

// A plain line holds all of its text in one span.
async function expectPlainLines(viewer: CodeView<undefined>): Promise<void> {
  const plain = [[LINE], [LINE]];
  await waitFor(() =>
    Bun.deepEquals(changedLines(viewer).map(spanTexts), plain)
  );
  expect(changedLines(viewer).map(spanTexts)).toEqual(plain);
}

// A highlighted line keeps its text and gives the `const` keyword its own
// token.
function expectHighlightedLines(viewer: CodeView<undefined>): void {
  const lines = changedLines(viewer);
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    expect(line?.textContent).toBe(LINE);
    expect(spanTexts(line)[0]).toBe('const');
  }
}

async function waitForHighlightedLines(
  viewer: CodeView<undefined>
): Promise<void> {
  await waitFor(() => {
    const lines = changedLines(viewer);
    return (
      lines.length === 2 &&
      lines.every((line) => spanTexts(line)[0] === 'const')
    );
  });
  expectHighlightedLines(viewer);
}

test('an empty mount starts a pool that is not running', async () => {
  const { manager, workers } = createPool();
  // The constructor already started the pool. Stop it so that only the mount
  // can start it again.
  manager.terminate();
  await wait(0);
  expect(manager.getStats()).toMatchObject({
    managerState: 'waiting',
    totalWorkers: 0,
  });
  expect(workers.every(({ terminated }) => terminated)).toBe(true);

  mount(manager);
  expect(manager.getStats().managerState).toBe('initializing');
  await waitForLiveWorker(workers);
});

test('an empty mount leaves a failed pool alone and items highlight locally', async () => {
  spyOn(console, 'error').mockImplementation(() => {});
  const { manager } = createPool({
    workerFactory: () => {
      throw new Error('worker unavailable');
    },
  });
  await manager.initialize().catch(() => {});
  expect(manager.shouldUseLocalFallback()).toBe(true);
  const initialize = spyOn(manager, 'initialize');

  const viewer = mount(manager);
  viewer.setItems(items);
  viewer.render(true);
  await waitForHighlightedLines(viewer);
  expect(initialize).not.toHaveBeenCalled();
});

test('a delayed theme renders file and diff rows without another render call', async () => {
  const theme = 'codeview-ready-delayed-theme';
  const load = createDeferred<ThemeRegistration>();
  registerCustomTheme(theme, () => load.promise);
  teardown.push(() => customThemes.delete(theme));
  const { manager } = createPool({}, { theme });
  const viewer = mount(manager);
  viewer.setItems(items);
  viewer.render(true);
  await wait(0);
  expect(viewer.getRenderedItems()).toEqual([]);

  load.resolve({ name: theme, type: 'dark', colors: {}, tokenColors: [] });
  await expectPlainLines(viewer);
});

test('a rejected language preload lets available files highlight locally without workers', async () => {
  spyOn(console, 'error').mockImplementation(() => {});
  const ruby = 'codeview-ready-ruby';
  const preload = createDeferred<{ default: LanguageRegistration[] }>();
  const loader = mock(() => preload.promise);
  registerCustomLanguage(ruby, loader);
  teardown.push(() => RegisteredCustomLanguages.delete(ruby));
  const { manager, workers } = createPool({}, { langs: [ruby] });
  const viewer = mount(manager);
  viewer.setItems(items);
  viewer.render(true);

  // TypeScript is already loaded, so its rows display while Ruby loads.
  await expectPlainLines(viewer);
  expect(loader).toHaveBeenCalled();
  expect(manager.getStats().managerState).toBe('initializing');

  preload.reject(new Error('Ruby preload failed'));
  await waitForHighlightedLines(viewer);
  expect(manager.shouldUseLocalFallback()).toBe(true);
  expect(manager.getStats().workersFailed).toBe(false);
  expect(workers).toEqual([]);
});

test('threshold-sized items paint main-thread syntax on their first render', async () => {
  const { manager, workers } = createPool({ mainThreadMaxCharacters: 200 });
  // A live worker exists, but its initialize reply is held through the mount.
  const worker = await waitForLiveWorker(workers);

  const viewer = mount(manager);
  viewer.setItems(items);
  viewer.render(true);
  expect(manager.getStats().readyWorkers).toBe(0);
  expectHighlightedLines(viewer);

  // Once the worker is ready it could take this work, but none is sent to it.
  await acknowledgeInitialize(worker);
  await withTimeout(manager.initialize());
  expect(manager.getStats().readyWorkers).toBe(1);
  await wait(0);
  expect(worker.fileRequestCount + worker.diffRequestCount).toBe(0);
});

test.each(['acknowledges', 'fails'] as const)(
  'plain rows paint while worker replies are held and gain syntax when the worker %s',
  async (outcome) => {
    const { manager, workers } = createPool();
    const viewer = mount(manager);
    viewer.setItems(items);
    viewer.render(true);
    const worker = await waitForLiveWorker(workers);
    await expectPlainLines(viewer);
    expect(manager.getStats().readyWorkers).toBe(0);

    if (outcome === 'fails') {
      spyOn(console, 'error').mockImplementation(() => {});
      // The pool retries a failed worker once. Fail the initial worker, then
      // fail its replacement, and the pool falls back to local highlighting.
      worker.emitError(new Error('worker unavailable'));
      const retry = await waitForLiveWorker(workers);
      expect(retry).not.toBe(worker);
      retry.emitError(new Error('worker unavailable'));
      await waitFor(() => manager.shouldUseLocalFallback());
      expect(manager.shouldUseLocalFallback()).toBe(true);
    } else {
      await acknowledgeInitialize(worker);
      const fileRequest = await withTimeout(worker.waitForFileRequest());
      const fileOptions = manager.getFileRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'file',
        id: fileRequest.id,
        options: fileOptions,
        result: renderFileWithHighlighter(
          fileRequest.file,
          highlighter,
          fileOptions
        ),
        sentAt: Date.now(),
      });
      const diffRequest = await withTimeout(worker.waitForDiffRequest());
      const diffOptions = manager.getDiffRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: diffRequest.id,
        options: diffOptions,
        result: renderDiffWithHighlighter(
          diffRequest.diff,
          highlighter,
          diffOptions
        ),
        sentAt: Date.now(),
      });
    }
    await waitForHighlightedLines(viewer);
  }
);
