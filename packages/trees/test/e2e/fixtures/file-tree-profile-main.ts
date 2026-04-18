import {
  createFileTreeProfileFixtureOptions,
  createFileTreeProfileWorkloadSummary,
  DEFAULT_FILE_TREE_PROFILE_WORKLOAD_NAME,
  FILE_TREE_PROFILE_WORKLOAD_NAMES,
  type FileTreeProfilePageSummary,
  getFileTreeProfileWorkload,
} from '../../../scripts/lib/fileTreeProfileShared';
import type { FileTree as FileTreeClass } from '../../../src/index';
import { createBenchmarkInstrumentation } from './file-tree-profile-benchmarkInstrumentation';

// @ts-expect-error -- the Vite fixture serves the built trees dist from the
// package root so profiling exercises the same output the script builds.
const { FileTree } = (await import('/dist/index.js')) as {
  FileTree: typeof FileTreeClass;
};

declare global {
  interface Performance {
    memory?: {
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
      usedJSHeapSize: number;
    };
  }

  interface Window {
    __treesFileTreeFixtureReady?: boolean;
    __treesFileTreeProfile?: FileTreeProfilePageSummary;
    treesFileTreeProfile?: {
      configureFixture: (config: { workloadName?: string }) => {
        workloadName: string;
      };
      getState: () => {
        hasRenderedTree: boolean;
        workload: ReturnType<typeof createFileTreeProfileWorkloadSummary>;
      };
      profileRender: () => Promise<FileTreeProfilePageSummary>;
    };
  }
}

interface LongTaskEntry {
  duration: number;
  startTime: number;
}

const START_MARK_NAME = 'trees-file-tree-profile-start';
const END_MARK_NAME = 'trees-file-tree-profile-end';
const MEASURE_NAME = 'trees-file-tree-profile-measure';
const START_TRACE_LABEL = 'trees-file-tree-profile-start';
const END_TRACE_LABEL = 'trees-file-tree-profile-end';

const searchParams = new URLSearchParams(window.location.search);
const instrumentationEnabled = searchParams.get('instrumentation') !== '0';

function requireElement<TElement extends Element>(
  selector: string,
  expectedType: { new (): TElement }
): TElement {
  const element = document.querySelector(selector);
  if (!(element instanceof expectedType)) {
    throw new Error(`Missing ${selector} element.`);
  }

  return element;
}

const mount = requireElement('[data-profile-mount]', HTMLDivElement);
const renderButton = requireElement(
  '[data-profile-render-button]',
  HTMLButtonElement
);
const workloadInput = requireElement('#workload', HTMLSelectElement);

for (const workloadName of FILE_TREE_PROFILE_WORKLOAD_NAMES) {
  const option = document.createElement('option');
  option.value = workloadName;
  option.textContent = workloadName;
  workloadInput.appendChild(option);
}

const initialWorkloadName =
  searchParams.get('workload') ?? DEFAULT_FILE_TREE_PROFILE_WORKLOAD_NAME;
workloadInput.value = initialWorkloadName;
if (workloadInput.value === '') {
  workloadInput.value = DEFAULT_FILE_TREE_PROFILE_WORKLOAD_NAME;
}

let currentFileTree: FileTreeClass | null = null;
const longTaskEntries: LongTaskEntry[] = [];
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

function clearRenderedTree(): void {
  currentFileTree?.cleanUp();
  currentFileTree = null;
  mount.innerHTML = '';
}

function clearProfileSummary(): void {
  delete window.__treesFileTreeProfile;
  performance.clearMarks(START_MARK_NAME);
  performance.clearMarks(END_MARK_NAME);
  performance.clearMeasures(MEASURE_NAME);
}

function getSelectedWorkloadName(): string {
  return workloadInput.value === ''
    ? DEFAULT_FILE_TREE_PROFILE_WORKLOAD_NAME
    : workloadInput.value;
}

function getSelectedWorkload() {
  return getFileTreeProfileWorkload(getSelectedWorkloadName());
}

async function waitForRenderedTree(): Promise<{
  host: HTMLElement;
  renderedItemCount: number;
}> {
  const startedAt = performance.now();

  while (true) {
    const host = mount.querySelector('file-tree-container');
    const renderedItemCount =
      host?.shadowRoot?.querySelectorAll('button[data-type="item"]').length ??
      0;
    if (host instanceof HTMLElement && renderedItemCount > 0) {
      return { host, renderedItemCount };
    }

    if (performance.now() - startedAt > 30_000) {
      throw new Error('Timed out waiting for the file-tree to render.');
    }

    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

async function waitForPaint(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function getTaskOverlapMs(
  entry: LongTaskEntry,
  startTime: number,
  endTime: number
): number {
  const overlapStart = Math.max(entry.startTime, startTime);
  const overlapEnd = Math.min(entry.startTime + entry.duration, endTime);
  return Math.max(0, overlapEnd - overlapStart);
}

async function profileRender(): Promise<FileTreeProfilePageSummary> {
  renderButton.disabled = true;
  renderButton.textContent = 'Rendering…';

  clearProfileSummary();
  clearRenderedTree();

  const benchmark = instrumentationEnabled
    ? createBenchmarkInstrumentation()
    : null;
  benchmark?.reset();

  const workload = getSelectedWorkload();
  const renderStartedAt = performance.now();
  const heapBefore = benchmark?.readHeapSnapshot() ?? null;
  performance.mark(START_MARK_NAME);
  console.timeStamp(START_TRACE_LABEL);

  try {
    const options =
      benchmark == null
        ? createFileTreeProfileFixtureOptions(workload)
        : benchmark.instrumentation.measurePhase('page.createOptions', () =>
            createFileTreeProfileFixtureOptions(workload)
          );
    benchmark?.instrumentation.setCounter(
      'workload.inputFiles',
      workload.files.length
    );
    benchmark?.instrumentation.setCounter(
      'workload.expandedFolders',
      workload.expandedFolders.length
    );

    const fileTree =
      benchmark == null
        ? new FileTree({
            ...options,
            id: 'file-tree-profile',
          })
        : benchmark.instrumentation.measurePhase(
            'page.createFileTree',
            () =>
              new FileTree({
                ...options,
                id: 'file-tree-profile',
              })
          );
    currentFileTree = fileTree;

    if (benchmark == null) {
      fileTree.render({ containerWrapper: mount });
    } else {
      benchmark.instrumentation.measurePhase('page.renderTree', () => {
        fileTree.render({ containerWrapper: mount });
      });
    }

    const { renderedItemCount } =
      benchmark == null
        ? await waitForRenderedTree()
        : await benchmark.instrumentation.measurePhase(
            'page.waitForRenderReady',
            () => waitForRenderedTree()
          );
    const visibleRowsReadyAt = performance.now();
    await waitForPaint();
    const heapAfter = benchmark?.readHeapSnapshot() ?? null;

    performance.mark(END_MARK_NAME);
    console.timeStamp(END_TRACE_LABEL);
    performance.measure(MEASURE_NAME, START_MARK_NAME, END_MARK_NAME);

    const measure = performance.getEntriesByName(MEASURE_NAME).at(-1);
    const renderEndedAt = performance.now();
    const renderLongTasks = longTaskEntries
      .map((entry) => ({
        ...entry,
        overlapMs: getTaskOverlapMs(entry, renderStartedAt, renderEndedAt),
      }))
      .filter((entry) => entry.overlapMs > 0);
    const longTaskCount = renderLongTasks.length;
    const longTaskTotalMs = renderLongTasks.reduce((total, entry) => {
      return total + entry.overlapMs;
    }, 0);
    const longestLongTaskMs = renderLongTasks.reduce((longest, entry) => {
      return Math.max(longest, entry.overlapMs);
    }, 0);
    const instrumentation = benchmark?.summarize(heapBefore, heapAfter) ?? {
      phases: [],
      counters: {},
      heap: null,
    };
    instrumentation.counters['workload.renderedRows'] = renderedItemCount;

    const summary: FileTreeProfilePageSummary = {
      instrumentation,
      longTaskCount,
      longTaskTotalMs,
      longestLongTaskMs,
      renderDurationMs: measure?.duration ?? 0,
      renderedItemCount,
      resultText: `Post-paint ready ${formatMs(
        measure?.duration ?? 0
      )}. Visible rows ready ${formatMs(
        visibleRowsReadyAt - renderStartedAt
      )}. Visible rows ${renderedItemCount}. Long tasks ${longTaskCount}; total ${formatMs(
        longTaskTotalMs
      )}; longest ${formatMs(longestLongTaskMs)}.`,
      visibleRowsReadyMs: visibleRowsReadyAt - renderStartedAt,
      workload: createFileTreeProfileWorkloadSummary(workload),
    };

    window.__treesFileTreeProfile = summary;
    console.info('[trees file-tree profile]', summary.resultText);
    renderButton.textContent = 'Rendered';
    return summary;
  } finally {
    renderButton.disabled = false;
    if (window.__treesFileTreeProfile == null) {
      renderButton.textContent = 'Render';
    }
  }
}

function configureFixture(config: { workloadName?: string }): {
  workloadName: string;
} {
  const requestedWorkloadName =
    config.workloadName ?? getSelectedWorkloadName();
  const workload = getFileTreeProfileWorkload(requestedWorkloadName);
  workloadInput.value = workload.name;
  clearRenderedTree();
  clearProfileSummary();
  renderButton.textContent = 'Render';
  return {
    workloadName: workload.name,
  };
}

function getState() {
  return {
    hasRenderedTree: currentFileTree != null,
    workload: createFileTreeProfileWorkloadSummary(getSelectedWorkload()),
  };
}

renderButton.addEventListener('click', () => {
  void profileRender();
});

workloadInput.addEventListener('input', () => {
  clearRenderedTree();
  clearProfileSummary();
  renderButton.textContent = 'Render';
});

window.treesFileTreeProfile = {
  configureFixture,
  getState,
  profileRender,
};
window.__treesFileTreeFixtureReady = true;
