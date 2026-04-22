import {
  createFileTreeProfileFixtureOptions,
  createFileTreeProfileWorkloadSummary,
  DEFAULT_FILE_TREE_PROFILE_WORKLOAD_NAME,
  FILE_TREE_PROFILE_WORKLOAD_NAMES,
  type FileTreeProfileActionDispatch,
  type FileTreeProfileActionInitialExpansion,
  type FileTreeProfileActionOperation,
  type FileTreeProfileActionSetupOperation,
  type FileTreeProfileActionSummary,
  type FileTreeProfileActionTargetVisibility,
  type FileTreeProfilePageSummary,
  type FileTreeProfileWorkload,
  getFileTreeProfileWorkload,
} from '../../../scripts/lib/fileTreeProfileShared';
import type {
  FileTree as FileTreeClass,
  FileTreeDirectoryHandle,
} from '../../../src/index';
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
    __treesFileTreeProfileError?: string;
    treesFileTreeProfile?: {
      beginPreparedActionClickProfile: () => Promise<PreparedActionClickTarget>;
      configureFixture: (config: { workloadName?: string }) => Promise<{
        workloadName: string;
      }>;
      getState: () => Promise<{
        actionScenarioCount: number | null;
        hasRenderedTree: boolean;
        preparedActionId: string | null;
        workload: ReturnType<typeof createFileTreeProfileWorkloadSummary>;
      }>;
      listExpansionActionScenarios: () => Promise<
        FileTreeProfileActionSummary[]
      >;
      prepareActionProfile: (
        actionId: string
      ) => Promise<FileTreeProfileActionSummary>;
      profilePreparedAction: () => Promise<FileTreeProfilePageSummary>;
      profileRender: () => Promise<FileTreeProfilePageSummary>;
    };
  }
}

interface LongTaskEntry {
  duration: number;
  startTime: number;
}

interface DirectoryCandidate {
  depth: number;
  hasDescendants: boolean;
  isMounted: boolean;
  path: string;
}

type ActionRowMode = 'flow' | 'sticky';
type Benchmark = ReturnType<typeof createBenchmarkInstrumentation>;
type HeapSnapshot = ReturnType<Benchmark['readHeapSnapshot']>;

interface PreparedActionClickTarget {
  x: number;
  y: number;
}

interface PreparedActionContext {
  item: FileTreeDirectoryHandle;
  scenario: FileTreeProfileActionSummary;
  targetWasExpandedBefore: boolean;
}

interface PreparedActionProfileState extends PreparedActionContext {
  actionStartedAt: number;
  benchmark: Benchmark | null;
  heapBefore: HeapSnapshot;
  renderedItemCountBefore: number;
  updatePromise: Promise<void>;
  workload: FileTreeProfileWorkload;
}

const START_MARK_NAME = 'trees-file-tree-profile-start';
const END_MARK_NAME = 'trees-file-tree-profile-end';
const MEASURE_NAME = 'trees-file-tree-profile-measure';
const START_TRACE_LABEL = 'trees-file-tree-profile-start';
const END_TRACE_LABEL = 'trees-file-tree-profile-end';
const TREE_UPDATE_TIMEOUT_MS = 30_000;
const AOSP_WORKLOAD_NAME = 'aosp';
const AOSP_WORKLOAD_URL = '/trees-dev/aosp-files.json.gz';

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
let cachedExpansionActionScenarios: FileTreeProfileActionSummary[] | null =
  null;
let cachedExpansionActionWorkloadName: string | null = null;
let preparedActionScenario: FileTreeProfileActionSummary | null = null;
const workloadPromiseCache = new Map<
  string,
  Promise<FileTreeProfileWorkload>
>();
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

function clearActionScenarioCache(): void {
  cachedExpansionActionScenarios = null;
  cachedExpansionActionWorkloadName = null;
  preparedActionScenario = null;
}

function clearRenderedTree(): void {
  currentFileTree?.cleanUp();
  currentFileTree = null;
  preparedActionScenario = null;
  mount.innerHTML = '';
}

function clearProfileSummary(): void {
  delete window.__treesFileTreeProfile;
  delete window.__treesFileTreeProfileError;
  performance.clearMarks(START_MARK_NAME);
  performance.clearMarks(END_MARK_NAME);
  performance.clearMeasures(MEASURE_NAME);
}

function getSelectedWorkloadName(): string {
  return workloadInput.value === ''
    ? DEFAULT_FILE_TREE_PROFILE_WORKLOAD_NAME
    : workloadInput.value;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item): item is string => typeof item === 'string')
  ) {
    throw new Error(
      `Invalid AOSP profile workload: expected ${label} strings.`
    );
  }
  return value;
}

function parseAospPayload(value: unknown): {
  allExpandedPaths: string[];
  paths: string[];
} {
  if (typeof value !== 'object' || value == null) {
    throw new Error('Invalid AOSP profile workload: expected a JSON object.');
  }

  const payload = value as {
    allExpandedPaths?: unknown;
    paths?: unknown;
  };
  return {
    allExpandedPaths: assertStringArray(
      payload.allExpandedPaths,
      'allExpandedPaths'
    ),
    paths: assertStringArray(payload.paths, 'paths'),
  };
}

async function parseAospPayloadBytes(bytes: ArrayBuffer): Promise<{
  allExpandedPaths: string[];
  paths: string[];
}> {
  try {
    return parseAospPayload(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (directParseError) {
    if (typeof DecompressionStream === 'undefined') {
      throw directParseError;
    }

    const decompressedBytes = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    ).arrayBuffer();
    return parseAospPayload(
      JSON.parse(new TextDecoder().decode(decompressedBytes))
    );
  }
}

async function loadAospProfileWorkload(): Promise<FileTreeProfileWorkload> {
  const response = await fetch(AOSP_WORKLOAD_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to load AOSP profile workload from ${AOSP_WORKLOAD_URL}: ${response.status} ${response.statusText}`
    );
  }

  const { allExpandedPaths, paths } = await parseAospPayloadBytes(
    await response.arrayBuffer()
  );
  return {
    expandedFolders: allExpandedPaths,
    files: paths,
    label: 'AOSP fixture',
    name: AOSP_WORKLOAD_NAME,
  };
}

async function loadFileTreeProfileWorkload(
  workloadName: string
): Promise<FileTreeProfileWorkload> {
  const cachedWorkload = workloadPromiseCache.get(workloadName);
  if (cachedWorkload != null) {
    return cachedWorkload;
  }

  const workloadPromise =
    workloadName === AOSP_WORKLOAD_NAME
      ? loadAospProfileWorkload()
      : Promise.resolve(getFileTreeProfileWorkload(workloadName));
  workloadPromiseCache.set(workloadName, workloadPromise);
  return workloadPromise;
}

async function getSelectedWorkload(): Promise<FileTreeProfileWorkload> {
  return await loadFileTreeProfileWorkload(getSelectedWorkloadName());
}

function getRenderedItemCount(): number {
  return (
    mount
      .querySelector('file-tree-container')
      ?.shadowRoot?.querySelectorAll('button[data-type="item"]').length ?? 0
  );
}

function getProfileShadowRoot(): ShadowRoot {
  const host = mount.querySelector('file-tree-container');
  if (!(host instanceof HTMLElement) || host.shadowRoot == null) {
    throw new Error('Cannot find the rendered file-tree shadow root.');
  }

  return host.shadowRoot;
}

function getVirtualizedScrollElement(): HTMLElement {
  const scrollElement = getProfileShadowRoot().querySelector(
    '[data-file-tree-virtualized-scroll="true"]'
  );
  if (!(scrollElement instanceof HTMLElement)) {
    throw new Error('Cannot find the rendered file-tree scroll element.');
  }

  return scrollElement;
}

function getMountedFolderPaths(): Set<string> {
  const rows =
    mount
      .querySelector('file-tree-container')
      ?.shadowRoot?.querySelectorAll(
        'button[data-type="item"][data-item-type="folder"]:not([data-file-tree-sticky-row="true"])'
      ) ?? [];
  return new Set(
    Array.from(rows)
      .map((row) => row.getAttribute('data-item-path') ?? '')
      .filter((path) => path !== '')
  );
}

function getPathDepth(path: string): number {
  const segmentCount = path.split('/').filter(Boolean).length;
  return Math.max(0, segmentCount - 1);
}

function getButtonPath(button: HTMLButtonElement, mode: ActionRowMode): string {
  return mode === 'sticky'
    ? (button.dataset.fileTreeStickyPath ?? button.dataset.itemPath ?? '')
    : (button.dataset.itemPath ?? '');
}

function findFolderRowButton(
  path: string,
  mode: ActionRowMode
): HTMLButtonElement | null {
  const buttons = Array.from(
    getProfileShadowRoot().querySelectorAll(
      'button[data-type="item"][data-item-type="folder"]'
    )
  );
  for (const button of buttons) {
    if (!(button instanceof HTMLButtonElement)) {
      continue;
    }

    const isSticky = button.dataset.fileTreeStickyRow === 'true';
    if (mode === 'sticky' ? !isSticky : isSticky) {
      continue;
    }

    if (getButtonPath(button, mode) === path) {
      return button;
    }
  }

  return null;
}

function getActionRowButton(
  scenario: FileTreeProfileActionSummary
): HTMLButtonElement {
  const mode: ActionRowMode =
    scenario.targetVisibility === 'sticky' ? 'sticky' : 'flow';
  const matchingButton = findFolderRowButton(scenario.targetPath, mode);

  if (!(matchingButton instanceof HTMLButtonElement)) {
    throw new Error(
      `Cannot click profile action ${scenario.id}; target row is not mounted: ${scenario.targetPath}.`
    );
  }

  return matchingButton;
}

async function waitForFolderRowButton(
  path: string,
  mode: ActionRowMode
): Promise<HTMLButtonElement> {
  const startedAt = performance.now();

  while (performance.now() - startedAt < TREE_UPDATE_TIMEOUT_MS) {
    const button = findFolderRowButton(path, mode);
    if (button != null) {
      return button;
    }

    await new Promise((resolve) => setTimeout(resolve, 16));
  }

  throw new Error(`Timed out waiting for ${mode} row ${path}.`);
}

async function prepareStickyActionTarget(path: string): Promise<void> {
  if (currentFileTree == null) {
    throw new Error('Cannot prepare a sticky action target before rendering.');
  }

  const item = getDirectoryHandle(path);
  let flowButton = findFolderRowButton(path, 'flow');
  if (flowButton == null && !item.isFocused()) {
    const updatePromise = waitForNextTreeUpdate(currentFileTree);
    item.focus();
    await updatePromise;
  }
  await waitForPaint();

  flowButton = await waitForFolderRowButton(path, 'flow');
  const scrollElement = getVirtualizedScrollElement();
  const rowRect = flowButton.getBoundingClientRect();
  const scrollRect = scrollElement.getBoundingClientRect();
  const rowHeight =
    rowRect.height > 0 ? rowRect.height : currentFileTree.getItemHeight();
  scrollElement.scrollTop += Math.max(
    0,
    rowRect.top - scrollRect.top + rowHeight
  );
  await waitForPaint();
  await waitForFolderRowButton(path, 'sticky');
}

function getClickTarget(element: HTMLElement): PreparedActionClickTarget {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('Cannot click profile action target with an empty rect.');
  }

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getDirectoryHandle(path: string): FileTreeDirectoryHandle {
  const item = currentFileTree?.getItem(path);
  if (item == null || !item.isDirectory()) {
    throw new Error(
      `Expected profile action target to be a directory: ${path}`
    );
  }
  return item as FileTreeDirectoryHandle;
}

async function waitForRenderedTree(): Promise<{
  host: HTMLElement;
  renderedItemCount: number;
}> {
  const startedAt = performance.now();

  while (true) {
    const host = mount.querySelector('file-tree-container');
    const renderedItemCount = getRenderedItemCount();
    if (host instanceof HTMLElement && renderedItemCount > 0) {
      return { host, renderedItemCount };
    }

    if (performance.now() - startedAt > TREE_UPDATE_TIMEOUT_MS) {
      throw new Error('Timed out waiting for the file-tree to render.');
    }

    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

async function waitForAnimationFrame(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

async function waitForPaint(): Promise<void> {
  await waitForAnimationFrame();
  await waitForAnimationFrame();
}

function waitForNextTreeUpdate(fileTree: FileTreeClass): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = window.setTimeout(() => {
      unsubscribe?.();
      reject(new Error('Timed out waiting for the file-tree action update.'));
    }, TREE_UPDATE_TIMEOUT_MS);

    unsubscribe = fileTree.subscribe(() => {
      window.clearTimeout(timeout);
      unsubscribe?.();
      resolve();
    });
  });
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

function summarizeLongTasks(
  startTime: number,
  endTime: number
): {
  longTaskCount: number;
  longTaskTotalMs: number;
  longestLongTaskMs: number;
} {
  const overlappingTasks = longTaskEntries
    .map((entry) => ({
      ...entry,
      overlapMs: getTaskOverlapMs(entry, startTime, endTime),
    }))
    .filter((entry) => entry.overlapMs > 0);
  return {
    longTaskCount: overlappingTasks.length,
    longTaskTotalMs: overlappingTasks.reduce((total, entry) => {
      return total + entry.overlapMs;
    }, 0),
    longestLongTaskMs: overlappingTasks.reduce((longest, entry) => {
      return Math.max(longest, entry.overlapMs);
    }, 0),
  };
}

function createBenchmark(): Benchmark | null {
  return instrumentationEnabled ? createBenchmarkInstrumentation() : null;
}

function createProfileOptions(
  initialExpansion: FileTreeProfileActionInitialExpansion,
  benchmark: Benchmark | null,
  workload: FileTreeProfileWorkload
) {
  const createOptions = () =>
    createFileTreeProfileFixtureOptions(workload, { initialExpansion });
  return benchmark == null
    ? createOptions()
    : benchmark.instrumentation.measurePhase(
        'page.createOptions',
        createOptions
      );
}

function setWorkloadCounters(
  benchmark: Benchmark | null,
  workload: FileTreeProfileWorkload
): void {
  if (benchmark == null) {
    return;
  }

  benchmark.instrumentation.setCounter(
    'workload.inputFiles',
    workload.files.length
  );
  benchmark.instrumentation.setCounter(
    'workload.expandedFolders',
    workload.expandedFolders.length
  );
}

function createProfileFileTree(
  initialExpansion: FileTreeProfileActionInitialExpansion,
  benchmark: Benchmark | null,
  workload: FileTreeProfileWorkload
): FileTreeClass {
  const options = createProfileOptions(initialExpansion, benchmark, workload);
  setWorkloadCounters(benchmark, workload);

  return benchmark == null
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
}

async function renderProfileTree(
  initialExpansion: FileTreeProfileActionInitialExpansion,
  benchmark: Benchmark | null,
  workload: FileTreeProfileWorkload
): Promise<{
  fileTree: FileTreeClass;
  renderedItemCount: number;
}> {
  clearRenderedTree();
  const fileTree = createProfileFileTree(initialExpansion, benchmark, workload);
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
  return { fileTree, renderedItemCount };
}

// Computes which directories have visible descendants without repeatedly
// scanning the full workload for each action candidate.
function collectDirectoryPathsWithDescendants(
  workload: FileTreeProfileWorkload
): Set<string> {
  const directoryPaths = new Set(workload.expandedFolders);
  const pathsWithDescendants = new Set<string>();

  for (const filePath of workload.files) {
    let slashIndex = filePath.indexOf('/');
    while (slashIndex > 0) {
      const directoryPath = filePath.slice(0, slashIndex);
      if (directoryPaths.has(directoryPath)) {
        pathsWithDescendants.add(directoryPath);
      }
      slashIndex = filePath.indexOf('/', slashIndex + 1);
    }
  }

  return pathsWithDescendants;
}

function collectDirectoryCandidates(
  fileTree: FileTreeClass,
  mountedPaths: Set<string>,
  workload: FileTreeProfileWorkload
): DirectoryCandidate[] {
  const seenPaths = new Set<string>();
  const candidates: DirectoryCandidate[] = [];
  const pathsWithDescendants = collectDirectoryPathsWithDescendants(workload);
  for (const path of workload.expandedFolders) {
    const item = fileTree.getItem(path);
    if (item == null || !item.isDirectory()) {
      continue;
    }

    const canonicalPath = item.getPath();
    if (seenPaths.has(canonicalPath)) {
      continue;
    }

    seenPaths.add(canonicalPath);
    candidates.push({
      depth: getPathDepth(canonicalPath),
      hasDescendants:
        pathsWithDescendants.has(canonicalPath) ||
        pathsWithDescendants.has(path),
      isMounted: mountedPaths.has(canonicalPath),
      path: canonicalPath,
    });
  }
  return candidates;
}

function selectCandidate(
  candidates: readonly DirectoryCandidate[],
  usedPaths: Set<string>,
  predicate: (candidate: DirectoryCandidate) => boolean,
  pick: 'first' | 'last' | 'middle'
): DirectoryCandidate | null {
  const matches = candidates.filter((candidate) => {
    return !usedPaths.has(candidate.path) && predicate(candidate);
  });
  if (matches.length === 0) {
    return null;
  }

  if (pick === 'last') {
    return matches[matches.length - 1] ?? null;
  }
  if (pick === 'middle') {
    return matches[Math.floor(matches.length / 2)] ?? null;
  }
  return matches[0] ?? null;
}

function createActionScenario({
  dispatch,
  id,
  initialExpansion,
  label,
  operation,
  setupOperations = [],
  target,
  targetVisibility,
}: {
  dispatch?: FileTreeProfileActionDispatch;
  id: string;
  initialExpansion: FileTreeProfileActionInitialExpansion;
  label: string;
  operation: FileTreeProfileActionOperation;
  setupOperations?: FileTreeProfileActionSetupOperation[];
  target: DirectoryCandidate;
  targetVisibility: FileTreeProfileActionTargetVisibility;
}): FileTreeProfileActionSummary {
  return {
    dispatch:
      dispatch ??
      (targetVisibility === 'visible' || targetVisibility === 'sticky'
        ? 'dom-click'
        : 'api'),
    id,
    initialExpansion,
    label,
    operation,
    setupOperations,
    targetDepth: target.depth,
    targetPath: target.path,
    targetVisibility,
  };
}

async function buildExpansionActionScenarios(): Promise<
  FileTreeProfileActionSummary[]
> {
  const workload = await getSelectedWorkload();
  const scenarios: FileTreeProfileActionSummary[] = [];
  const usedOpenPaths = new Set<string>();

  const { fileTree: openTree } = await renderProfileTree(
    'open',
    null,
    workload
  );
  await waitForPaint();
  const openMountedPaths = getMountedFolderPaths();
  const openCandidates = collectDirectoryCandidates(
    openTree,
    openMountedPaths,
    workload
  );
  const openTargets = [
    {
      id: 'open-visible-shallow',
      label: 'Open visible shallow',
      pick: 'first' as const,
      predicate: (candidate: DirectoryCandidate) =>
        candidate.isMounted && candidate.depth <= 1,
      visibility: 'visible' as const,
    },
    {
      id: 'open-visible-deep',
      label: 'Open visible deep',
      pick: 'last' as const,
      predicate: (candidate: DirectoryCandidate) =>
        candidate.isMounted && candidate.depth >= 2,
      visibility: 'visible' as const,
    },
    {
      id: 'open-sticky-shallow',
      label: 'Open sticky shallow',
      pick: 'first' as const,
      predicate: (candidate: DirectoryCandidate) =>
        candidate.isMounted && candidate.hasDescendants && candidate.depth <= 1,
      visibility: 'sticky' as const,
    },
    {
      id: 'open-sticky-deep',
      label: 'Open sticky deep',
      pick: 'last' as const,
      predicate: (candidate: DirectoryCandidate) =>
        candidate.isMounted && candidate.hasDescendants && candidate.depth >= 2,
      visibility: 'sticky' as const,
    },
    {
      id: 'open-offscreen-mid',
      label: 'Open offscreen mid-depth',
      pick: 'middle' as const,
      predicate: (candidate: DirectoryCandidate) =>
        !candidate.isMounted && candidate.depth >= 1 && candidate.depth <= 3,
      visibility: 'offscreen' as const,
    },
    {
      id: 'open-offscreen-deep',
      label: 'Open offscreen deep',
      pick: 'last' as const,
      predicate: (candidate: DirectoryCandidate) =>
        !candidate.isMounted && candidate.depth >= 4,
      visibility: 'offscreen' as const,
    },
  ];

  for (const targetConfig of openTargets) {
    const target = selectCandidate(
      openCandidates,
      usedOpenPaths,
      targetConfig.predicate,
      targetConfig.pick
    );
    if (target == null) {
      continue;
    }

    usedOpenPaths.add(target.path);
    scenarios.push(
      createActionScenario({
        id: `${targetConfig.id}-collapse`,
        initialExpansion: 'open',
        label: `${targetConfig.label} collapse`,
        operation: 'collapse',
        target,
        targetVisibility: targetConfig.visibility,
      })
    );
    if (targetConfig.visibility !== 'sticky') {
      scenarios.push(
        createActionScenario({
          id: `${targetConfig.id}-expand`,
          initialExpansion: 'open',
          label: `${targetConfig.label} expand`,
          operation: 'expand',
          setupOperations: [{ operation: 'collapse', path: target.path }],
          target,
          targetVisibility: targetConfig.visibility,
        })
      );
    }
  }

  const { fileTree: closedTree } = await renderProfileTree(
    'closed',
    null,
    workload
  );
  await waitForPaint();
  const closedMountedPaths = getMountedFolderPaths();
  const closedCandidates = collectDirectoryCandidates(
    closedTree,
    closedMountedPaths,
    workload
  );
  const usedClosedPaths = new Set<string>();
  const closedVisibleTop = selectCandidate(
    closedCandidates,
    usedClosedPaths,
    (candidate) => candidate.isMounted && candidate.depth === 0,
    'first'
  );
  if (closedVisibleTop != null) {
    usedClosedPaths.add(closedVisibleTop.path);
    scenarios.push(
      createActionScenario({
        id: 'closed-visible-top-expand',
        initialExpansion: 'closed',
        label: 'Closed visible top-level expand',
        operation: 'expand',
        target: closedVisibleTop,
        targetVisibility: 'visible',
      })
    );
  }

  const closedHiddenDeep =
    selectCandidate(
      closedCandidates,
      usedClosedPaths,
      (candidate) => !candidate.isMounted && candidate.depth >= 4,
      'last'
    ) ??
    selectCandidate(
      closedCandidates,
      usedClosedPaths,
      (candidate) => !candidate.isMounted && candidate.depth >= 2,
      'last'
    );
  if (closedHiddenDeep != null) {
    scenarios.push(
      createActionScenario({
        id: 'closed-hidden-deep-expand',
        initialExpansion: 'closed',
        label: 'Closed hidden deep expand',
        operation: 'expand',
        target: closedHiddenDeep,
        targetVisibility: 'hidden',
      })
    );
  }

  clearRenderedTree();
  renderButton.textContent = 'Render';
  return scenarios;
}

async function listExpansionActionScenarios(): Promise<
  FileTreeProfileActionSummary[]
> {
  const workloadName = getSelectedWorkloadName();
  if (
    cachedExpansionActionScenarios != null &&
    cachedExpansionActionWorkloadName === workloadName
  ) {
    return cachedExpansionActionScenarios;
  }

  clearProfileSummary();
  cachedExpansionActionScenarios = await buildExpansionActionScenarios();
  cachedExpansionActionWorkloadName = workloadName;
  return cachedExpansionActionScenarios;
}

async function applySetupOperation(
  operation: FileTreeProfileActionSetupOperation
): Promise<void> {
  if (currentFileTree == null) {
    throw new Error('Cannot apply an action setup before rendering the tree.');
  }

  const item = getDirectoryHandle(operation.path);
  const shouldBeExpanded = operation.operation === 'expand';
  if (item.isExpanded() === shouldBeExpanded) {
    return;
  }

  const updatePromise = waitForNextTreeUpdate(currentFileTree);
  if (shouldBeExpanded) {
    item.expand();
  } else {
    item.collapse();
  }
  await updatePromise;
  await waitForPaint();
}

async function prepareActionProfile(
  actionId: string
): Promise<FileTreeProfileActionSummary> {
  const scenarios = await listExpansionActionScenarios();
  const scenario = scenarios.find((candidate) => candidate.id === actionId);
  if (scenario == null) {
    throw new Error(`Unknown file-tree profile action scenario: ${actionId}`);
  }

  clearProfileSummary();
  await renderProfileTree(
    scenario.initialExpansion,
    null,
    await getSelectedWorkload()
  );
  await waitForPaint();
  for (const operation of scenario.setupOperations) {
    await applySetupOperation(operation);
  }
  if (scenario.targetVisibility === 'sticky') {
    await prepareStickyActionTarget(scenario.targetPath);
  }

  preparedActionScenario = scenario;
  return scenario;
}

async function profileRender(): Promise<FileTreeProfilePageSummary> {
  renderButton.disabled = true;
  renderButton.textContent = 'Rendering...';

  clearProfileSummary();
  const benchmark = createBenchmark();
  benchmark?.reset();
  const workload = await getSelectedWorkload();

  const renderStartedAt = performance.now();
  const heapBefore = benchmark?.readHeapSnapshot() ?? null;
  performance.mark(START_MARK_NAME);
  console.timeStamp(START_TRACE_LABEL);

  try {
    const { renderedItemCount } = await renderProfileTree(
      'open',
      benchmark,
      workload
    );
    const visibleRowsReadyAt = performance.now();
    await waitForPaint();
    const heapAfter = benchmark?.readHeapSnapshot() ?? null;

    performance.mark(END_MARK_NAME);
    console.timeStamp(END_TRACE_LABEL);
    performance.measure(MEASURE_NAME, START_MARK_NAME, END_MARK_NAME);

    const measure = performance.getEntriesByName(MEASURE_NAME).at(-1);
    const renderEndedAt = performance.now();
    const { longTaskCount, longTaskTotalMs, longestLongTaskMs } =
      summarizeLongTasks(renderStartedAt, renderEndedAt);
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
      profileKind: 'render',
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

function getPreparedActionContext(): PreparedActionContext {
  if (currentFileTree == null || preparedActionScenario == null) {
    throw new Error(
      'Call prepareActionProfile(actionId) before profiling a prepared action.'
    );
  }

  const scenario = preparedActionScenario;
  const item = getDirectoryHandle(scenario.targetPath);
  const targetWasExpandedBefore = item.isExpanded();
  if (
    (scenario.operation === 'expand' && targetWasExpandedBefore) ||
    (scenario.operation === 'collapse' && !targetWasExpandedBefore)
  ) {
    throw new Error(
      `Profile action ${scenario.id} would be a no-op for ${scenario.targetPath}.`
    );
  }

  return {
    item,
    scenario,
    targetWasExpandedBefore,
  };
}

async function startPreparedActionProfile(
  context: PreparedActionContext
): Promise<PreparedActionProfileState> {
  const fileTree = currentFileTree;
  if (fileTree == null) {
    throw new Error('Cannot profile an action before rendering the tree.');
  }

  clearProfileSummary();
  const benchmark = createBenchmark();
  benchmark?.reset();
  const workload = await getSelectedWorkload();
  setWorkloadCounters(benchmark, workload);

  const renderedItemCountBefore = getRenderedItemCount();
  const actionStartedAt = performance.now();
  const heapBefore = benchmark?.readHeapSnapshot() ?? null;
  performance.mark(START_MARK_NAME);
  console.timeStamp(START_TRACE_LABEL);

  const updatePromise = waitForNextTreeUpdate(fileTree);

  return {
    ...context,
    actionStartedAt,
    benchmark,
    heapBefore,
    renderedItemCountBefore,
    updatePromise,
    workload,
  };
}

async function finishPreparedActionProfile(
  state: PreparedActionProfileState,
  getActionDurationMs: () => number | null
): Promise<FileTreeProfilePageSummary> {
  const {
    actionStartedAt,
    benchmark,
    heapBefore,
    item,
    renderedItemCountBefore,
    scenario,
    targetWasExpandedBefore,
    updatePromise,
    workload,
  } = state;

  if (benchmark == null) {
    await updatePromise;
  } else {
    await benchmark.instrumentation.measurePhase(
      'action.waitForTreeUpdate',
      () => updatePromise
    );
  }

  if (benchmark == null) {
    await waitForAnimationFrame();
  } else {
    await benchmark.instrumentation.measurePhase(
      'action.waitForVisibleRows',
      () => waitForAnimationFrame()
    );
  }
  const visibleRowsReadyAt = performance.now();
  const { renderedItemCount } = await waitForRenderedTree();

  if (benchmark == null) {
    await waitForAnimationFrame();
  } else {
    await benchmark.instrumentation.measurePhase('action.waitForPaint', () =>
      waitForAnimationFrame()
    );
  }
  const heapAfter = benchmark?.readHeapSnapshot() ?? null;

  performance.mark(END_MARK_NAME);
  console.timeStamp(END_TRACE_LABEL);
  performance.measure(MEASURE_NAME, START_MARK_NAME, END_MARK_NAME);

  const rawActionDurationMs = getActionDurationMs();
  const actionDurationMs =
    rawActionDurationMs == null ? null : Math.max(0, rawActionDurationMs);
  const targetIsExpandedAfter = item.isExpanded();
  const measure = performance.getEntriesByName(MEASURE_NAME).at(-1);
  const actionEndedAt = performance.now();
  const { longTaskCount, longTaskTotalMs, longestLongTaskMs } =
    summarizeLongTasks(actionStartedAt, actionEndedAt);
  const instrumentation = benchmark?.summarize(heapBefore, heapAfter) ?? {
    phases: [],
    counters: {},
    heap: null,
  };
  instrumentation.counters['workload.renderedRows'] = renderedItemCount;
  instrumentation.counters['workload.renderedRowsBefore'] =
    renderedItemCountBefore;
  instrumentation.counters['workload.actionTargetDepth'] = scenario.targetDepth;
  if (actionDurationMs != null) {
    instrumentation.counters['workload.actionDurationMs'] = actionDurationMs;
  }

  const action: FileTreeProfileActionSummary = {
    ...scenario,
    renderedItemCountAfter: renderedItemCount,
    renderedItemCountBefore,
    targetIsExpandedAfter,
    targetWasExpandedBefore,
  };
  const summary: FileTreeProfilePageSummary = {
    action,
    instrumentation,
    longTaskCount,
    longTaskTotalMs,
    longestLongTaskMs,
    profileKind: 'action',
    renderDurationMs: measure?.duration ?? 0,
    renderedItemCount,
    resultText: `${action.label}: ${action.operation} ${action.targetPath}. Input ${action.dispatch}. API action dispatch ${
      actionDurationMs == null ? 'n/a' : formatMs(actionDurationMs)
    }. Post-paint ready ${formatMs(
      measure?.duration ?? 0
    )}. Visible rows ready ${formatMs(
      visibleRowsReadyAt - actionStartedAt
    )}. Rendered rows ${renderedItemCountBefore} -> ${renderedItemCount}. Long tasks ${longTaskCount}; total ${formatMs(
      longTaskTotalMs
    )}; longest ${formatMs(longestLongTaskMs)}.`,
    visibleRowsReadyMs: visibleRowsReadyAt - actionStartedAt,
    workload: createFileTreeProfileWorkloadSummary(workload),
    ...(actionDurationMs == null ? {} : { actionDurationMs }),
  };

  window.__treesFileTreeProfile = summary;
  console.info('[trees file-tree profile]', summary.resultText);
  return summary;
}

async function profilePreparedAction(): Promise<FileTreeProfilePageSummary> {
  const context = getPreparedActionContext();
  if (context.scenario.dispatch !== 'api') {
    throw new Error(
      `Profile action ${context.scenario.id} is configured for DOM click dispatch.`
    );
  }

  const state = await startPreparedActionProfile(context);
  const { benchmark, item, scenario } = state;
  const dispatchStartedAt = performance.now();
  if (benchmark == null) {
    if (scenario.operation === 'expand') {
      item.expand();
    } else {
      item.collapse();
    }
  } else {
    benchmark.instrumentation.measurePhase('action.dispatch', () => {
      if (scenario.operation === 'expand') {
        item.expand();
      } else {
        item.collapse();
      }
    });
  }
  const actionDurationMs = performance.now() - dispatchStartedAt;

  return await finishPreparedActionProfile(state, () => actionDurationMs);
}

async function beginPreparedActionClickProfile(): Promise<PreparedActionClickTarget> {
  const context = getPreparedActionContext();
  if (context.scenario.dispatch !== 'dom-click') {
    throw new Error(
      `Profile action ${context.scenario.id} is configured for direct API dispatch.`
    );
  }

  const targetButton = getActionRowButton(context.scenario);
  const target = getClickTarget(targetButton);
  const state = await startPreparedActionProfile(context);

  void finishPreparedActionProfile(state, () => null).catch(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      window.__treesFileTreeProfileError = message;
      console.error('[trees file-tree profile] action click failed', error);
    }
  );

  return target;
}

async function configureFixture(config: { workloadName?: string }): Promise<{
  workloadName: string;
}> {
  const requestedWorkloadName =
    config.workloadName ?? getSelectedWorkloadName();
  const workload = await loadFileTreeProfileWorkload(requestedWorkloadName);
  workloadInput.value = workload.name;
  clearActionScenarioCache();
  clearRenderedTree();
  clearProfileSummary();
  renderButton.textContent = 'Render';
  return {
    workloadName: workload.name,
  };
}

async function getState() {
  const workload = await getSelectedWorkload();
  return {
    actionScenarioCount: cachedExpansionActionScenarios?.length ?? null,
    hasRenderedTree: currentFileTree != null,
    preparedActionId: preparedActionScenario?.id ?? null,
    workload: createFileTreeProfileWorkloadSummary(workload),
  };
}

renderButton.addEventListener('click', () => {
  void profileRender();
});

workloadInput.addEventListener('input', () => {
  clearActionScenarioCache();
  clearRenderedTree();
  clearProfileSummary();
  renderButton.textContent = 'Render';
});

window.treesFileTreeProfile = {
  beginPreparedActionClickProfile,
  configureFixture,
  getState,
  listExpansionActionScenarios,
  prepareActionProfile,
  profilePreparedAction,
  profileRender,
};
window.__treesFileTreeFixtureReady = true;
