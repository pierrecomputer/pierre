import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ProfileConfig {
  browserUrl: string;
  instrumentationMode: 'on' | 'off';
  url: string;
  workloads: string[];
  actions: string[];
  visibleCount: number;
  offset: number;
  timeoutMs: number;
  runs: number;
  warmupRuns: number;
  showDominantTraceEvents: boolean;
  outputJson: boolean;
  traceOutputPath: string;
  ensureServer: boolean;
}

interface TraceEvent {
  name: string;
  cat?: string;
  ph: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
  args?: {
    data?: {
      message?: string;
      name?: string;
      type?: string;
    };
    name?: string;
  };
}

interface TraceFile {
  traceEvents: TraceEvent[];
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

interface CpuProfileNodeCallFrame {
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

interface CpuProfileNode {
  id: number;
  callFrame: CpuProfileNodeCallFrame;
  children?: number[];
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

interface RuntimeEvaluateResult<TValue> {
  result?: {
    value?: TValue;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
      value?: string;
    };
  };
}

interface InspectVersionResponse {
  webSocketDebuggerUrl: string;
}

interface NewTargetResponse {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

interface PageLoadEventFiredParams {
  timestamp: number;
}

interface PageWorkloadSummary {
  flattenEmptyDirectories: boolean;
  name: string;
  label: string;
  fileCount: number;
  expandedFolderCount: number;
}

interface PageActionSummary {
  id: string;
  label: string;
}

interface PageProfileSummary {
  action: PageActionSummary;
  afterRows: string[];
  beforeRows: string[] | null;
  beforeVisibleCount: number | null;
  detail: string;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestLongTaskMs: number;
  instrumentation?: {
    counters: Record<string, number>;
    heap: {
      jsHeapSizeLimitBytes: number;
      totalJSHeapSizeAfterBytes: number;
      usedJSHeapSizeAfterBytes: number;
      usedJSHeapSizeBeforeBytes: number;
      usedJSHeapSizeDeltaBytes: number;
    } | null;
    phases: Array<{
      count: number;
      durationMs: number;
      name: string;
      selfDurationMs: number;
    }>;
  } | null;
  postPaintReadyMs: number;
  renderedRowCount: number;
  requestedVisibleCount: number;
  resultText: string | null;
  visibleCount: number;
  visibleRowsReadyMs: number;
  windowOffset: number;
  workload: PageWorkloadSummary;
}

interface TraceWindow {
  startTs: number;
  endTs: number;
  pid?: number;
  tid?: number;
  source: string;
}

interface TraceSummary {
  available: boolean;
  windowSource: string | null;
  windowDurationMs: number | null;
  actionToPostPaintReadyMs: number | null;
  mainThreadBusyMs: number | null;
  longestTaskMs: number | null;
  topLevelTaskCount: number | null;
  gcMs: number | null;
  styleLayoutMs: number | null;
  paintCompositeMs: number | null;
  dominantEvents: Array<{
    name: string;
    durationMs: number;
    percentOfWindow: number | null;
  }>;
}

interface BottomUpFunctionSummary {
  name: string;
  selfMs: number;
  totalMs: number;
  selfPercent: number | null;
  totalPercent: number | null;
}

interface CpuProfileSummary {
  available: boolean;
  sampleCount: number | null;
  sampledMs: number | null;
  bottomUpFunctions: BottomUpFunctionSummary[];
}

interface ProfileRunResult {
  runNumber: number;
  browserUrl: string;
  url: string;
  traceOutputPath: string | null;
  page: PageProfileSummary;
  trace: TraceSummary;
  cpuProfile: CpuProfileSummary;
}

interface AggregateMetricSummary {
  label: string;
  availableRuns: number;
  totalMs: number | null;
  averageMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
}

type AggregateMetricKey =
  | 'visibleRowsReadyMs'
  | 'postPaintReadyMs'
  | 'traceWindowMs'
  | 'mainThreadBusyMs'
  | 'longestTopLevelTaskMs'
  | 'longTaskTotalMs'
  | 'sampledCpuTimeMs';

interface JsonAggregateSummary {
  measuredRuns: number;
  metrics: Record<AggregateMetricKey, AggregateMetricSummary>;
}

interface ProfileScenarioSummary {
  workload: PageWorkloadSummary;
  action: PageActionSummary;
}

interface ProfileScenarioOutput {
  scenario: ProfileScenarioSummary;
  runs: ProfileRunResult[];
  summary: JsonAggregateSummary;
}

interface ProfileConfigSummary {
  browserUrl: string;
  instrumentationMode: 'on' | 'off';
  url: string;
  workloads: string[];
  actions: string[];
  visibleCount: number;
  offset: number;
  timeoutMs: number;
  runs: number;
  warmupRuns: number;
  showDominantTraceEvents: boolean;
}

interface ProfileBenchmarkOutput {
  benchmark: 'pathStoreDemoProfile';
  config: ProfileConfigSummary;
  scenarios: ProfileScenarioOutput[];
}

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_BROWSER_URL = 'http://127.0.0.1:9222';
const DEFAULT_URL = 'http://127.0.0.1:4175/';
const DEFAULT_WORKLOAD_NAME = 'linux-5x';
const DEFAULT_ACTION_ID = 'render';
const DEFAULT_INSTRUMENTATION_MODE = 'on';
const DEFAULT_VISIBLE_COUNT = 30;
const DEFAULT_OFFSET = 0;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RUN_COUNT = 1;
const DEFAULT_WARMUP_RUN_COUNT = 0;
const DEFAULT_TRACE_OUTPUT_DIR = resolve(
  tmpdir(),
  'pierrejs-path-store-traces'
);
const DEFAULT_TRACE_OUTPUT_EXAMPLE_PATH = resolve(
  DEFAULT_TRACE_OUTPUT_DIR,
  'path-store-demo-profile-trace-<run-id>.json'
);
const TRACE_START_SETTLE_MS = 200;
const TRACE_COMPLETION_TIMEOUT_MS = 30_000;
const CPU_PROFILE_SAMPLING_INTERVAL_US = 1_000;
const BOTTOM_UP_FUNCTION_LIMIT = 8;
const TRACE_CATEGORIES = [
  'blink.user_timing',
  'devtools.timeline',
  'toplevel',
  'v8.execute',
].join(',');
const FIXTURE_READY_EXPRESSION = `window.__pathStoreDemoFixtureReady === true`;
const PROFILE_START_LABEL = 'path-store-demo-profile-start';
const PROFILE_END_LABEL = 'path-store-demo-profile-end';
const KNOWN_WORKLOAD_NAMES = new Set([
  'demo-small',
  'linux',
  'linux-5x',
  'linux-10x',
]);
const ALL_ACTION_IDS = [
  'render',
  'collapse-visible-folder',
  'expand-visible-folder',
  'rename-visible-folder',
  'delete-visible-folder',
  'rename-visible-leaf',
  'delete-visible-leaf',
  'move-visible-folder-to-parent',
  'move-visible-leaf-to-parent',
  'collapse-folder-above-viewport',
  'begin-async-load',
  'apply-async-patch',
  'complete-async-load',
  'fail-async-load',
  'cooperative-apply-async-patch',
  'cooperative-apply-async-patch-yieldy',
] as const;
const KNOWN_ACTION_IDS = new Set<string>(ALL_ACTION_IDS);
const TOP_LEVEL_TASK_NAMES = new Set([
  'RunTask',
  'ThreadControllerImpl::RunTask',
]);
const GC_EVENT_NAMES = new Set(['MinorGC', 'MajorGC']);
const STYLE_LAYOUT_EVENT_NAMES = new Set([
  'UpdateLayoutTree',
  'Layout',
  'ScheduleStyleRecalculation',
  'InvalidateLayout',
  'RecalculateStyles',
]);
const PAINT_EVENT_NAMES = new Set([
  'PrePaint',
  'Paint',
  'PaintImage',
  'Commit',
  'CompositeLayers',
]);
const CPU_PROFILE_IGNORED_FUNCTION_NAMES = new Set([
  '(root)',
  '(program)',
  '(idle)',
  '(garbage collector)',
]);
const DOMINANT_EVENT_IGNORED_PREFIXES = ['V8.GC_'];
const INTERNAL_CPU_PROFILE_URL_SNIPPETS = [
  '/node_modules/',
  '/.vite/deps/',
  'benchmarkInstrumentation',
  '/src/internal/benchmarkInstrumentation.ts',
  'extensions::',
  'native ',
  'node:',
  'inspector://',
];
const INTEGER_FORMATTER = new Intl.NumberFormat('en-US');
const AGGREGATE_METRIC_DEFINITIONS: Array<{
  key: AggregateMetricKey;
  label: string;
  select: (result: ProfileRunResult) => number | null;
}> = [
  {
    key: 'visibleRowsReadyMs',
    label: 'Visible rows ready',
    select: (result) => result.page.visibleRowsReadyMs,
  },
  {
    key: 'postPaintReadyMs',
    label: 'Post-paint ready',
    select: (result) => result.page.postPaintReadyMs,
  },
  {
    key: 'traceWindowMs',
    label: 'Trace window',
    select: (result) => result.trace.windowDurationMs,
  },
  {
    key: 'mainThreadBusyMs',
    label: 'Main-thread busy',
    select: (result) => result.trace.mainThreadBusyMs,
  },
  {
    key: 'longestTopLevelTaskMs',
    label: 'Longest top-level task',
    select: (result) => result.trace.longestTaskMs,
  },
  {
    key: 'longTaskTotalMs',
    label: 'Long task total',
    select: (result) => result.page.longTaskTotalMs,
  },
  {
    key: 'sampledCpuTimeMs',
    label: 'Sampled CPU time',
    select: (result) => result.cpuProfile.sampledMs,
  },
];

function printHelpAndExit(): never {
  console.log('Usage: bun ws path-store profile:demo -- [options]');
  console.log('');
  console.log(
    'Assumes Chrome is already running with --remote-debugging-port enabled.'
  );
  console.log('');
  console.log('Options:');
  console.log(
    `  --browser-url <url>      Chrome remote debugging base URL (default: ${DEFAULT_BROWSER_URL})`
  );
  console.log(
    `  --url <url>              Demo page to profile (default: ${DEFAULT_URL})`
  );
  console.log(
    `  --workload <name>        Demo workload to run (repeatable, default: ${DEFAULT_WORKLOAD_NAME})`
  );
  console.log(
    `  --action <id>            Demo action to profile (repeatable, default: ${DEFAULT_ACTION_ID})`
  );
  console.log('  --all-actions            Profile every supported demo action');
  console.log(
    `  --instrumentation <mode>  Demo instrumentation mode: on or off (default: ${DEFAULT_INSTRUMENTATION_MODE})`
  );
  console.log(
    `  --visible-count <count>  Visible window size to render (default: ${DEFAULT_VISIBLE_COUNT})`
  );
  console.log(
    `  --offset <count>         Visible window offset before profiling (default: ${DEFAULT_OFFSET})`
  );
  console.log(
    `  --timeout <ms>           Navigation/action timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`
  );
  console.log(
    `  --runs <count>           Number of measured runs per scenario (default: ${DEFAULT_RUN_COUNT})`
  );
  console.log(
    `  --warmup-runs <count>    Number of warm-up runs to discard (default: ${DEFAULT_WARMUP_RUN_COUNT})`
  );
  console.log(
    `  --trace-out <path>       Where to save Chrome traces when tracing succeeds (default: ${DEFAULT_TRACE_OUTPUT_EXAMPLE_PATH})`
  );
  console.log(
    '  --dominant-trace-events  Show lower-signal dominant trace event tables'
  );
  console.log(
    '  --no-server              Do not auto-start the path-store demo server'
  );
  console.log('  --json                   Emit machine-readable JSON output');
  console.log('  -h, --help               Show this help output');
  console.log('');
  console.log(`Known workloads: ${[...KNOWN_WORKLOAD_NAMES].join(', ')}`);
  console.log(`Known actions: ${[...KNOWN_ACTION_IDS].join(', ')}`);
  process.exit(0);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function parseWorkloadName(value: string): string {
  if (!KNOWN_WORKLOAD_NAMES.has(value)) {
    throw new Error(
      `Unknown workload "${value}". Known workloads: ${[...KNOWN_WORKLOAD_NAMES].join(', ')}`
    );
  }
  return value;
}

function parseActionId(value: string): string {
  if (!KNOWN_ACTION_IDS.has(value)) {
    throw new Error(
      `Unknown action "${value}". Known actions: ${[...KNOWN_ACTION_IDS].join(', ')}`
    );
  }
  return value;
}

function parseInstrumentationMode(value: string): 'on' | 'off' {
  if (value === 'on' || value === 'off') {
    return value;
  }

  throw new Error(
    `Invalid --instrumentation value '${value}'. Expected 'on' or 'off'.`
  );
}

function createTraceRunId(): string {
  return randomUUID().slice(0, 8);
}

function createDefaultTraceOutputPath(): string {
  return resolve(
    DEFAULT_TRACE_OUTPUT_DIR,
    `path-store-demo-profile-trace-${createTraceRunId()}.json`
  );
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-');
}

function createRunTraceOutputPath(
  traceOutputPath: string,
  workloadName: string,
  actionId: string,
  totalScenarios: number,
  runNumber: number,
  totalRuns: number
): string {
  const extensionIndex = traceOutputPath.lastIndexOf('.');
  const scenarioSuffix =
    totalScenarios > 1
      ? `-${sanitizePathSegment(workloadName)}-${sanitizePathSegment(actionId)}`
      : '';
  const runSuffix =
    totalRuns > 1
      ? `-run-${String(runNumber).padStart(String(totalRuns).length, '0')}`
      : '';
  const suffix = `${scenarioSuffix}${runSuffix}`;

  if (extensionIndex <= 0) {
    return `${traceOutputPath}${suffix}`;
  }

  return `${traceOutputPath.slice(0, extensionIndex)}${suffix}${traceOutputPath.slice(extensionIndex)}`;
}

function createProfileUrl(
  url: string,
  instrumentationMode: 'on' | 'off'
): string {
  const parsedUrl = new URL(url);
  if (!parsedUrl.searchParams.has('instrumentation')) {
    parsedUrl.searchParams.set(
      'instrumentation',
      instrumentationMode === 'on' ? '1' : '0'
    );
  }

  return parsedUrl.toString();
}

function parseArgs(argv: string[]): ProfileConfig {
  const config: ProfileConfig = {
    browserUrl: DEFAULT_BROWSER_URL,
    instrumentationMode: DEFAULT_INSTRUMENTATION_MODE,
    url: DEFAULT_URL,
    workloads: [DEFAULT_WORKLOAD_NAME],
    actions: [DEFAULT_ACTION_ID],
    visibleCount: DEFAULT_VISIBLE_COUNT,
    offset: DEFAULT_OFFSET,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    runs: DEFAULT_RUN_COUNT,
    warmupRuns: DEFAULT_WARMUP_RUN_COUNT,
    showDominantTraceEvents: false,
    outputJson: false,
    traceOutputPath: createDefaultTraceOutputPath(),
    ensureServer: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    if (rawArg === '--help' || rawArg === '-h') {
      printHelpAndExit();
    }

    if (rawArg === '--json') {
      config.outputJson = true;
      continue;
    }

    if (rawArg === '--dominant-trace-events') {
      config.showDominantTraceEvents = true;
      continue;
    }

    if (rawArg === '--all-actions') {
      config.actions = [...ALL_ACTION_IDS];
      continue;
    }

    if (rawArg === '--no-server') {
      config.ensureServer = false;
      continue;
    }

    const [flag, inlineValue] = rawArg.split('=', 2);
    if (
      flag === '--browser-url' ||
      flag === '--url' ||
      flag === '--workload' ||
      flag === '--action' ||
      flag === '--instrumentation' ||
      flag === '--visible-count' ||
      flag === '--offset' ||
      flag === '--timeout' ||
      flag === '--runs' ||
      flag === '--warmup-runs' ||
      flag === '--trace-out'
    ) {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) {
        throw new Error(`Missing value for ${flag}`);
      }
      if (inlineValue == null) {
        index += 1;
      }

      if (flag === '--browser-url') {
        config.browserUrl = value.replace(/\/$/, '');
      } else if (flag === '--url') {
        config.url = value;
      } else if (flag === '--workload') {
        if (
          config.workloads.length === 1 &&
          config.workloads[0] === DEFAULT_WORKLOAD_NAME
        ) {
          config.workloads = [];
        }
        config.workloads.push(parseWorkloadName(value));
      } else if (flag === '--action') {
        if (
          config.actions.length === 1 &&
          config.actions[0] === DEFAULT_ACTION_ID
        ) {
          config.actions = [];
        }
        config.actions.push(parseActionId(value));
      } else if (flag === '--instrumentation') {
        config.instrumentationMode = parseInstrumentationMode(value);
      } else if (flag === '--visible-count') {
        config.visibleCount = parsePositiveInteger(value, '--visible-count');
      } else if (flag === '--offset') {
        config.offset = parseNonNegativeInteger(value, '--offset');
      } else if (flag === '--timeout') {
        config.timeoutMs = parsePositiveInteger(value, '--timeout');
      } else if (flag === '--runs') {
        config.runs = parsePositiveInteger(value, '--runs');
      } else if (flag === '--warmup-runs') {
        config.warmupRuns = parseNonNegativeInteger(value, '--warmup-runs');
      } else {
        config.traceOutputPath = resolve(process.cwd(), value);
      }
      continue;
    }

    throw new Error(`Unknown argument: ${rawArg}`);
  }

  config.workloads = [...new Set(config.workloads)];
  config.actions = [...new Set(config.actions)];
  return config;
}

function formatMs(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return 'n/a';
  }
  return `${value.toFixed(2)} ms`;
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return 'n/a';
  }
  return `${value.toFixed(1)}%`;
}

function formatCount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return 'n/a';
  }
  return INTEGER_FORMATTER.format(Math.round(value));
}

function formatBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return 'n/a';
  }

  const absoluteValue = Math.abs(value);
  if (absoluteValue < 1024) {
    return `${value.toFixed(0)} B`;
  }
  if (absoluteValue < 1024 ** 2) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  if (absoluteValue < 1024 ** 3) {
    return `${(value / 1024 ** 2).toFixed(2)} MiB`;
  }
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

type TableAlignment = 'left' | 'right';

interface TableOptions {
  alignments?: TableAlignment[];
  maxWidths?: number[];
}

function truncateText(value: string, maxWidth: number | undefined): string {
  if (maxWidth == null || value.length <= maxWidth) {
    return value;
  }
  if (maxWidth <= 3) {
    return value.slice(0, maxWidth);
  }
  return `${value.slice(0, maxWidth - 3)}...`;
}

function padTableCell(
  value: string,
  width: number,
  alignment: TableAlignment
): string {
  return alignment === 'right' ? value.padStart(width) : value.padEnd(width);
}

function createTable(
  headers: string[],
  rows: string[][],
  options: TableOptions = {}
): string {
  const alignments = options.alignments ?? [];
  const normalizedHeaders = headers.map((header, index) =>
    truncateText(header, options.maxWidths?.[index])
  );
  const normalizedRows = rows.map((row) =>
    row.map((value, index) => truncateText(value, options.maxWidths?.[index]))
  );
  const widths = normalizedHeaders.map((header, index) => {
    return Math.max(
      header.length,
      ...normalizedRows.map((row) => row[index]?.length ?? 0)
    );
  });
  const border = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
  const formatRow = (row: string[]): string => {
    return `| ${row
      .map((value, index) =>
        padTableCell(value, widths[index], alignments[index] ?? 'left')
      )
      .join(' | ')} |`;
  };

  return [
    border,
    formatRow(normalizedHeaders),
    border,
    ...normalizedRows.map((row) => formatRow(row)),
    border,
  ].join('\n');
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) {
    return Number.NaN;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const index = (percentileValue / 100) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const weight = index - lowerIndex;
  return (
    sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight
  );
}

function summarizeAggregateMetric(
  label: string,
  results: ProfileRunResult[],
  selector: (result: ProfileRunResult) => number | null
): AggregateMetricSummary {
  const values = results
    .map(selector)
    .filter(
      (value): value is number => value != null && Number.isFinite(value)
    );
  if (values.length === 0) {
    return {
      label,
      availableRuns: 0,
      totalMs: null,
      averageMs: null,
      medianMs: null,
      p95Ms: null,
    };
  }

  const totalMs = values.reduce((total, value) => total + value, 0);
  const sortedValues = [...values].sort((left, right) => left - right);
  return {
    label,
    availableRuns: values.length,
    totalMs: Number(totalMs.toFixed(3)),
    averageMs: Number((totalMs / values.length).toFixed(3)),
    medianMs: Number(percentile(sortedValues, 50).toFixed(3)),
    p95Ms: Number(percentile(sortedValues, 95).toFixed(3)),
  };
}

function createJsonAggregateSummary(
  results: ProfileRunResult[]
): JsonAggregateSummary {
  const metrics = Object.fromEntries(
    AGGREGATE_METRIC_DEFINITIONS.map((definition) => [
      definition.key,
      summarizeAggregateMetric(definition.label, results, definition.select),
    ])
  ) as Record<AggregateMetricKey, AggregateMetricSummary>;

  return {
    measuredRuns: results.length,
    metrics,
  };
}

function createProfileConfigSummary(
  config: ProfileConfig
): ProfileConfigSummary {
  return {
    browserUrl: config.browserUrl,
    instrumentationMode: config.instrumentationMode,
    url: config.url,
    workloads: [...config.workloads],
    actions: [...config.actions],
    visibleCount: config.visibleCount,
    offset: config.offset,
    timeoutMs: config.timeoutMs,
    runs: config.runs,
    warmupRuns: config.warmupRuns,
    showDominantTraceEvents: config.showDominantTraceEvents,
  };
}

function createScenarioOutput(
  results: ProfileRunResult[]
): ProfileScenarioOutput {
  if (results.length === 0) {
    throw new Error('Cannot summarize an empty profile scenario.');
  }

  return {
    scenario: {
      workload: results[0].page.workload,
      action: results[0].page.action,
    },
    runs: results,
    summary: createJsonAggregateSummary(results),
  };
}

function createManagedTimeout(
  timeoutMs: number,
  callback: () => void
): ReturnType<typeof setTimeout> {
  const timeout = setTimeout(callback, timeoutMs);
  timeout.unref?.();
  return timeout;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = createManagedTimeout(timeoutMs, () => {
    controller.abort(new Error(`Timed out waiting for ${url}`));
  });

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<TValue>(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<TValue> {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return (await response.json()) as TValue;
}

async function isUrlReachable(
  url: string,
  timeoutMs: number
): Promise<boolean> {
  const isReachableWithMethod = async (
    method: 'HEAD' | 'GET'
  ): Promise<boolean> => {
    const response = await fetchWithTimeout(
      url,
      {
        method,
      },
      timeoutMs
    );
    if (method === 'GET') {
      response.body?.cancel().catch(() => {});
    }
    return response.ok;
  };

  try {
    if (await isReachableWithMethod('HEAD')) {
      return true;
    }
  } catch {
    // Fall back to GET for targets that reject or do not implement HEAD.
  }

  try {
    return await isReachableWithMethod('GET');
  } catch {
    return false;
  }
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isUrlReachable(url, 1_000)) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

/** Starts the local Vite demo server only when the target URL is not already available. */
async function startDemoServerIfNeeded(
  config: ProfileConfig
): Promise<Bun.Subprocess | null> {
  if (!config.ensureServer) {
    return null;
  }

  if (await isUrlReachable(config.url, 1_000)) {
    return null;
  }

  const serverProcess = Bun.spawn({
    cmd: ['bun', 'run', 'dev'],
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENT: '1',
    },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  try {
    await waitForUrl(config.url, config.timeoutMs);
    return serverProcess;
  } catch (error) {
    serverProcess.kill();
    throw error;
  }
}

function normalizeWebSocketMessage(
  data: string | ArrayBuffer | Buffer
): string {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  return data.toString('utf8');
}

class CdpClient {
  private readonly ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly listeners = new Map<
    string,
    Set<(params: unknown) => void>
  >();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(
        normalizeWebSocketMessage(event.data as string | ArrayBuffer | Buffer)
      ) as CdpMessage;

      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (pending == null) {
          return;
        }

        this.pending.delete(message.id);
        if (message.error != null) {
          pending.reject(new Error(message.error.message));
          return;
        }

        pending.resolve(message.result);
        return;
      }

      if (message.method == null) {
        return;
      }

      const listeners = this.listeners.get(message.method);
      if (listeners == null) {
        return;
      }

      for (const listener of listeners) {
        listener(message.params);
      }
    });
  }

  static async connect(url: string, timeoutMs: number): Promise<CdpClient> {
    const ws = new WebSocket(url);

    await new Promise<void>((resolve, reject) => {
      const timeout = createManagedTimeout(timeoutMs, () => {
        reject(new Error(`Timed out connecting to ${url}`));
      });

      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true }
      );

      ws.addEventListener(
        'error',
        () => {
          clearTimeout(timeout);
          reject(new Error(`Failed to connect to ${url}`));
        },
        { once: true }
      );
    });

    return new CdpClient(ws);
  }

  async send<TResult>(method: string, params?: object): Promise<TResult> {
    const id = this.nextId++;

    const resultPromise = new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
      });
    });

    this.ws.send(JSON.stringify({ id, method, params }));
    return resultPromise;
  }

  on(method: string, listener: (params: unknown) => void): () => void {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(method);
      }
    };
  }

  once<TParams>(
    method: string,
    timeoutMs: number,
    predicate?: (params: TParams) => boolean
  ): Promise<TParams> {
    return new Promise<TParams>((resolve, reject) => {
      const timeout = createManagedTimeout(timeoutMs, () => {
        cleanup();
        reject(new Error(`Timed out waiting for ${method}`));
      });

      const cleanup = this.on(method, (rawParams) => {
        const params = rawParams as TParams;
        if (predicate != null && !predicate(params)) {
          return;
        }

        clearTimeout(timeout);
        cleanup();
        resolve(params);
      });
    });
  }

  close(): void {
    for (const [id, pending] of this.pending.entries()) {
      pending.reject(new Error(`CDP connection closed before response ${id}`));
    }
    this.pending.clear();
    this.ws.close();
  }
}

async function evaluateJson<TValue>(
  cdp: CdpClient,
  expression: string
): Promise<TValue> {
  const response = await cdp.send<RuntimeEvaluateResult<TValue>>(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }
  );

  if (response.exceptionDetails != null) {
    const detail =
      response.exceptionDetails.exception?.description ??
      response.exceptionDetails.exception?.value ??
      response.exceptionDetails.text ??
      'Unknown runtime error';
    throw new Error(detail);
  }

  return response.result?.value as TValue;
}

async function navigateToDemo(
  cdp: CdpClient,
  url: string,
  timeoutMs: number
): Promise<void> {
  const loadEvent = cdp.once<PageLoadEventFiredParams>(
    'Page.loadEventFired',
    timeoutMs
  );
  await cdp.send('Page.navigate', { url });
  await loadEvent;

  const ready = await evaluateJson<boolean>(
    cdp,
    `(async () => {
      const started = performance.now();
      while (performance.now() - started < ${timeoutMs}) {
        if (${FIXTURE_READY_EXPRESSION}) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    })()`
  );

  if (!ready) {
    throw new Error('Timed out waiting for the path-store demo to load.');
  }

  await cdp.send('Page.bringToFront');
}

async function createPageTarget(
  browserUrl: string,
  targetUrl: string,
  timeoutMs: number
): Promise<NewTargetResponse> {
  return await fetchJson<NewTargetResponse>(
    `${browserUrl}/json/new?${encodeURIComponent(targetUrl)}`,
    { method: 'PUT' },
    timeoutMs
  );
}

async function closePageTarget(
  browserUrl: string,
  targetId: string,
  timeoutMs: number
): Promise<void> {
  await fetchJson(
    `${browserUrl}/json/close/${targetId}`,
    undefined,
    timeoutMs
  ).catch(() => {});
}

function overlapDurationUs(
  startTs: number,
  durationUs: number,
  windowStartTs: number,
  windowEndTs: number
): number {
  const overlapStartTs = Math.max(startTs, windowStartTs);
  const overlapEndTs = Math.min(startTs + durationUs, windowEndTs);
  return Math.max(0, overlapEndTs - overlapStartTs);
}

function findMarkerEvent(
  events: TraceEvent[],
  label: string
): TraceEvent | null {
  return (
    events.find((event) => {
      if (typeof event.ts !== 'number') {
        return false;
      }

      if (event.name === label) {
        return true;
      }

      if (event.name !== 'TimeStamp') {
        return false;
      }

      const message =
        event.args?.data?.message ?? event.args?.data?.name ?? event.args?.name;
      return message === label;
    }) ?? null
  );
}

function findWindowFromMarkers(
  events: TraceEvent[],
  startLabel: string,
  endLabel: string,
  source: string
): TraceWindow | null {
  const startEvent = findMarkerEvent(events, startLabel);
  const endEvent = findMarkerEvent(events, endLabel);
  if (
    startEvent == null ||
    endEvent == null ||
    typeof startEvent.ts !== 'number' ||
    typeof endEvent.ts !== 'number' ||
    endEvent.ts < startEvent.ts
  ) {
    return null;
  }

  return {
    startTs: startEvent.ts,
    endTs: endEvent.ts,
    pid: startEvent.pid,
    tid: startEvent.tid,
    source,
  };
}

/** Falls back to the page's measured post-paint time when Chrome drops the start marker. */
function findTraceWindow(
  events: TraceEvent[],
  pageSummary: PageProfileSummary
): TraceWindow | null {
  const explicitWindow = findWindowFromMarkers(
    events,
    PROFILE_START_LABEL,
    PROFILE_END_LABEL,
    'profile-markers'
  );
  if (explicitWindow != null) {
    return explicitWindow;
  }

  const endEvent = findMarkerEvent(events, PROFILE_END_LABEL);
  if (
    endEvent != null &&
    typeof endEvent.ts === 'number' &&
    Number.isFinite(pageSummary.postPaintReadyMs) &&
    pageSummary.postPaintReadyMs > 0
  ) {
    return {
      startTs: endEvent.ts - Math.round(pageSummary.postPaintReadyMs * 1000),
      endTs: endEvent.ts,
      pid: endEvent.pid,
      tid: endEvent.tid,
      source: 'trace-end+page-measure',
    };
  }

  return null;
}

function createUnavailableTraceSummary(): TraceSummary {
  return {
    available: false,
    windowSource: null,
    windowDurationMs: null,
    actionToPostPaintReadyMs: null,
    mainThreadBusyMs: null,
    longestTaskMs: null,
    topLevelTaskCount: null,
    gcMs: null,
    styleLayoutMs: null,
    paintCompositeMs: null,
    dominantEvents: [],
  };
}

function summarizeEventsByName(
  events: TraceEvent[],
  window: TraceWindow,
  ignoredNames: Set<string>
): Array<{ name: string; durationMs: number; percentOfWindow: number | null }> {
  const totalsByName = new Map<string, number>();
  const windowDurationUs = window.endTs - window.startTs;

  for (const event of events) {
    if (
      event.name === '' ||
      ignoredNames.has(event.name) ||
      DOMINANT_EVENT_IGNORED_PREFIXES.some((prefix) =>
        event.name.startsWith(prefix)
      ) ||
      typeof event.ts !== 'number' ||
      typeof event.dur !== 'number'
    ) {
      continue;
    }

    const overlapUs = overlapDurationUs(
      event.ts,
      event.dur,
      window.startTs,
      window.endTs
    );
    if (overlapUs <= 0) {
      continue;
    }

    totalsByName.set(
      event.name,
      (totalsByName.get(event.name) ?? 0) + overlapUs
    );
  }

  return [...totalsByName.entries()]
    .map(([name, durationUs]) => ({
      name,
      durationMs: Number((durationUs / 1000).toFixed(3)),
      percentOfWindow:
        windowDurationUs <= 0
          ? null
          : Number(((durationUs / windowDurationUs) * 100).toFixed(1)),
    }))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 5);
}

function summarizeTrace(
  trace: TraceFile | null,
  pageSummary: PageProfileSummary
): TraceSummary {
  if (trace == null) {
    return createUnavailableTraceSummary();
  }

  const window = findTraceWindow(trace.traceEvents, pageSummary);
  if (window == null) {
    return createUnavailableTraceSummary();
  }

  const threadEvents = trace.traceEvents.filter(
    (event) =>
      event.ph === 'X' &&
      typeof event.ts === 'number' &&
      typeof event.dur === 'number' &&
      (window.pid == null || event.pid === window.pid) &&
      (window.tid == null || event.tid === window.tid)
  );
  const topLevelTasks = threadEvents.filter((event) =>
    TOP_LEVEL_TASK_NAMES.has(event.name)
  );
  const mainThreadBusyUs = topLevelTasks.reduce((totalUs, event) => {
    return (
      totalUs +
      overlapDurationUs(event.ts!, event.dur!, window.startTs, window.endTs)
    );
  }, 0);
  const longestTaskUs = topLevelTasks.reduce((longestUs, event) => {
    return Math.max(
      longestUs,
      overlapDurationUs(event.ts!, event.dur!, window.startTs, window.endTs)
    );
  }, 0);
  const sumNamedEventsUs = (eventNames: Set<string>): number => {
    return threadEvents.reduce((totalUs, event) => {
      if (!eventNames.has(event.name)) {
        return totalUs;
      }
      return (
        totalUs +
        overlapDurationUs(event.ts!, event.dur!, window.startTs, window.endTs)
      );
    }, 0);
  };

  return {
    available: true,
    windowSource: window.source,
    windowDurationMs: Number(
      ((window.endTs - window.startTs) / 1000).toFixed(3)
    ),
    actionToPostPaintReadyMs: Number(
      ((window.endTs - window.startTs) / 1000).toFixed(3)
    ),
    mainThreadBusyMs:
      topLevelTasks.length === 0
        ? null
        : Number((mainThreadBusyUs / 1000).toFixed(3)),
    longestTaskMs:
      topLevelTasks.length === 0
        ? null
        : Number((longestTaskUs / 1000).toFixed(3)),
    topLevelTaskCount: topLevelTasks.filter((event) => {
      return (
        overlapDurationUs(event.ts!, event.dur!, window.startTs, window.endTs) >
        0
      );
    }).length,
    gcMs: Number((sumNamedEventsUs(GC_EVENT_NAMES) / 1000).toFixed(3)),
    styleLayoutMs: Number(
      (sumNamedEventsUs(STYLE_LAYOUT_EVENT_NAMES) / 1000).toFixed(3)
    ),
    paintCompositeMs: Number(
      (sumNamedEventsUs(PAINT_EVENT_NAMES) / 1000).toFixed(3)
    ),
    dominantEvents: summarizeEventsByName(
      threadEvents,
      window,
      new Set([...TOP_LEVEL_TASK_NAMES, PROFILE_START_LABEL, PROFILE_END_LABEL])
    ),
  };
}

function formatSourcePath(url: string | undefined): string | null {
  if (url == null || url === '') {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    if (segments.length === 0) {
      return parsedUrl.pathname;
    }
    return segments.slice(-2).join('/');
  } catch {
    return url;
  }
}

function formatCallFrameLabel(callFrame: CpuProfileNodeCallFrame): string {
  const functionName =
    callFrame.functionName.trim() === ''
      ? '(anonymous)'
      : callFrame.functionName;
  const sourcePath = formatSourcePath(callFrame.url);
  if (sourcePath == null) {
    return functionName;
  }

  const lineNumber =
    typeof callFrame.lineNumber === 'number' ? callFrame.lineNumber + 1 : null;
  return lineNumber == null
    ? `${functionName} [${sourcePath}]`
    : `${functionName} [${sourcePath}:${lineNumber}]`;
}

function isInternalCpuProfileFrame(
  callFrame: CpuProfileNodeCallFrame
): boolean {
  return INTERNAL_CPU_PROFILE_URL_SNIPPETS.some((snippet) =>
    callFrame.url.includes(snippet)
  );
}

function createUnavailableCpuProfileSummary(): CpuProfileSummary {
  return {
    available: false,
    sampleCount: null,
    sampledMs: null,
    bottomUpFunctions: [],
  };
}

function summarizeCpuProfile(profile: CpuProfile | null): CpuProfileSummary {
  if (
    profile == null ||
    profile.samples == null ||
    profile.timeDeltas == null ||
    profile.samples.length === 0 ||
    profile.timeDeltas.length === 0
  ) {
    return createUnavailableCpuProfileSummary();
  }

  const sampleCount = Math.min(
    profile.samples.length,
    profile.timeDeltas.length
  );
  if (sampleCount === 0) {
    return createUnavailableCpuProfileSummary();
  }

  const nodeById = new Map<number, CpuProfileNode>();
  const parentById = new Map<number, number>();
  for (const node of profile.nodes) {
    nodeById.set(node.id, node);
    for (const childId of node.children ?? []) {
      parentById.set(childId, node.id);
    }
  }

  const totalsByFrame = new Map<
    string,
    {
      name: string;
      selfUs: number;
      totalUs: number;
      isInternal: boolean;
      isAnonymousWithoutSource: boolean;
    }
  >();

  const addDuration = (
    nodeId: number | undefined,
    durationUs: number,
    kind: 'self' | 'total'
  ): void => {
    if (nodeId == null || durationUs <= 0) {
      return;
    }

    const node = nodeById.get(nodeId);
    if (node == null) {
      return;
    }

    const functionName = node.callFrame.functionName.trim();
    if (CPU_PROFILE_IGNORED_FUNCTION_NAMES.has(functionName)) {
      return;
    }

    const key = JSON.stringify([
      functionName,
      node.callFrame.url,
      node.callFrame.lineNumber ?? null,
      node.callFrame.columnNumber ?? null,
    ]);
    const existingEntry = totalsByFrame.get(key) ?? {
      name: formatCallFrameLabel(node.callFrame),
      selfUs: 0,
      totalUs: 0,
      isInternal: isInternalCpuProfileFrame(node.callFrame),
      isAnonymousWithoutSource:
        functionName === '' &&
        (node.callFrame.url == null || node.callFrame.url === ''),
    };

    if (kind === 'self') {
      existingEntry.selfUs += durationUs;
    }
    existingEntry.totalUs += durationUs;
    totalsByFrame.set(key, existingEntry);
  };

  let sampledUs = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const leafNodeId = profile.samples[index];
    const durationUs = profile.timeDeltas[index] ?? 0;
    if (durationUs <= 0) {
      continue;
    }

    sampledUs += durationUs;
    addDuration(leafNodeId, durationUs, 'self');

    const visitedNodeIds = new Set<number>();
    let currentNodeId: number | undefined = leafNodeId;
    while (currentNodeId != null && !visitedNodeIds.has(currentNodeId)) {
      visitedNodeIds.add(currentNodeId);
      addDuration(currentNodeId, durationUs, 'total');
      currentNodeId = parentById.get(currentNodeId);
    }
  }

  const allFunctions = [...totalsByFrame.values()]
    .map((entry) => ({
      name: entry.name,
      selfMs: Number((entry.selfUs / 1000).toFixed(3)),
      totalMs: Number((entry.totalUs / 1000).toFixed(3)),
      selfPercent:
        sampledUs <= 0
          ? null
          : Number(((entry.selfUs / sampledUs) * 100).toFixed(1)),
      totalPercent:
        sampledUs <= 0
          ? null
          : Number(((entry.totalUs / sampledUs) * 100).toFixed(1)),
      isInternal: entry.isInternal,
      isAnonymousWithoutSource: entry.isAnonymousWithoutSource,
    }))
    .sort((left, right) => {
      if (right.selfMs !== left.selfMs) {
        return right.selfMs - left.selfMs;
      }
      return right.totalMs - left.totalMs;
    });
  const preferredFunctions = allFunctions.filter((entry) => {
    return !entry.isInternal && !entry.isAnonymousWithoutSource;
  });
  const selectedFunctions =
    preferredFunctions.length > 0 ? preferredFunctions : allFunctions;

  return {
    available: totalsByFrame.size > 0,
    sampleCount,
    sampledMs: Number((sampledUs / 1000).toFixed(3)),
    bottomUpFunctions: selectedFunctions
      .map(
        ({
          isInternal: _isInternal,
          isAnonymousWithoutSource: _isAnonymousWithoutSource,
          ...entry
        }) => entry
      )
      .slice(0, BOTTOM_UP_FUNCTION_LIMIT),
  };
}

function startTrace(cdp: CdpClient): Promise<TraceFile> {
  const traceEvents: TraceEvent[] = [];
  const removeListener = cdp.on('Tracing.dataCollected', (params) => {
    const payload = params as { value?: TraceEvent[] };
    if (payload.value != null) {
      traceEvents.push(...payload.value);
    }
  });

  const traceComplete = cdp
    .once('Tracing.tracingComplete', TRACE_COMPLETION_TIMEOUT_MS)
    .then(() => {
      removeListener();
      return { traceEvents };
    });

  return cdp
    .send('Tracing.start', {
      categories: TRACE_CATEGORIES,
      transferMode: 'ReportEvents',
    })
    .then(async () => {
      await Bun.sleep(TRACE_START_SETTLE_MS);
      return traceComplete;
    });
}

async function startCpuProfile(cdp: CdpClient): Promise<void> {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', {
    interval: CPU_PROFILE_SAMPLING_INTERVAL_US,
  });
  await cdp.send('Profiler.start');
}

async function stopCpuProfile(cdp: CdpClient): Promise<CpuProfile | null> {
  try {
    const response = await cdp.send<{ profile?: CpuProfile }>('Profiler.stop');
    return response.profile ?? null;
  } finally {
    await cdp.send('Profiler.disable').catch(() => {});
  }
}

async function withTimeout<TValue>(
  promise: Promise<TValue>,
  timeoutMs: number,
  message: string
): Promise<TValue> {
  return await new Promise<TValue>((resolve, reject) => {
    const timeout = createManagedTimeout(timeoutMs, () => {
      reject(new Error(message));
    });

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

async function collectProfilingArtifacts(
  cdp: CdpClient,
  timeoutMs: number,
  action: () => Promise<PageProfileSummary>
): Promise<{
  pageSummary: PageProfileSummary;
  trace: TraceFile | null;
  cpuProfile: CpuProfile | null;
}> {
  let tracePromise: Promise<TraceFile> | null = null;
  let cpuProfileStarted = false;

  try {
    tracePromise = startTrace(cdp);
  } catch {
    tracePromise = null;
  }

  try {
    await startCpuProfile(cdp);
    cpuProfileStarted = true;
  } catch {
    cpuProfileStarted = false;
  }

  let pageSummary: PageProfileSummary | null = null;
  let actionError: unknown = null;
  try {
    pageSummary = await action();
  } catch (error) {
    actionError = error;
  }

  let cpuProfile: CpuProfile | null = null;
  if (cpuProfileStarted) {
    try {
      cpuProfile = await stopCpuProfile(cdp);
    } catch {
      cpuProfile = null;
    }
  }

  if (actionError != null || pageSummary == null) {
    throw actionError ?? new Error('Failed to collect the profile summary.');
  }

  if (tracePromise == null) {
    return { pageSummary, trace: null, cpuProfile };
  }

  try {
    await cdp.send('Tracing.end');
    const trace = await withTimeout(
      tracePromise,
      Math.max(timeoutMs, TRACE_COMPLETION_TIMEOUT_MS),
      'Timed out waiting for trace completion'
    );
    return { pageSummary, trace, cpuProfile };
  } catch {
    return { pageSummary, trace: null, cpuProfile };
  }
}

function writeTraceIfAvailable(
  trace: TraceFile | null,
  traceOutputPath: string | null
): string | null {
  if (trace == null || traceOutputPath == null) {
    return null;
  }

  mkdirSync(dirname(traceOutputPath), { recursive: true });
  writeFileSync(traceOutputPath, JSON.stringify(trace));
  return traceOutputPath;
}

function createConfigureExpression(
  workloadName: string,
  visibleCount: number,
  offset: number
): string {
  return `window.pathStoreDemo.configureDemo(${JSON.stringify({
    workloadName,
    visibleCount,
    offset,
  })})`;
}

function createSetupRenderExpression(offset: number): string {
  return `(async () => {
    window.pathStoreDemo.renderStoreForSetup(${offset});
    return true;
  })()`;
}

function createPrepareActionExpression(actionId: string): string {
  return `window.pathStoreDemo.prepareProfileAction(${JSON.stringify(actionId)})`;
}

function createProfileRenderExpression(): string {
  return `window.pathStoreDemo.profileRenderStore()`;
}

function createProfileActionExpression(
  actionId: string,
  prepared: Record<string, unknown>
): string {
  return `window.pathStoreDemo.profilePreparedAction(${JSON.stringify(
    actionId
  )}, ${JSON.stringify(prepared)})`;
}

async function profileDemoScenario(
  config: ProfileConfig,
  workloadName: string,
  actionId: string,
  runNumber: number,
  totalScenarios: number,
  traceOutputPath: string | null
): Promise<ProfileRunResult> {
  const profileUrl = createProfileUrl(config.url, config.instrumentationMode);
  const version = await fetchJson<InspectVersionResponse>(
    `${config.browserUrl}/json/version`,
    undefined,
    config.timeoutMs
  );
  if (version.webSocketDebuggerUrl === '') {
    throw new Error(
      `Chrome at ${config.browserUrl} did not expose a browser WebSocket URL.`
    );
  }

  const target = await createPageTarget(
    config.browserUrl,
    profileUrl,
    config.timeoutMs
  );
  const cdp = await CdpClient.connect(
    target.webSocketDebuggerUrl,
    config.timeoutMs
  );

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await navigateToDemo(cdp, profileUrl, config.timeoutMs);
    await evaluateJson(
      cdp,
      createConfigureExpression(
        workloadName,
        config.visibleCount,
        config.offset
      )
    );

    if (actionId !== 'render') {
      await evaluateJson(cdp, createSetupRenderExpression(config.offset));
    }

    const prepared =
      actionId === 'render'
        ? null
        : await evaluateJson<Record<string, unknown>>(
            cdp,
            createPrepareActionExpression(actionId)
          );

    const { pageSummary, trace, cpuProfile } = await collectProfilingArtifacts(
      cdp,
      config.timeoutMs,
      async () => {
        if (actionId === 'render') {
          return await evaluateJson<PageProfileSummary>(
            cdp,
            createProfileRenderExpression()
          );
        }

        if (prepared == null) {
          throw new Error(`Missing prepared payload for action ${actionId}.`);
        }

        return await evaluateJson<PageProfileSummary>(
          cdp,
          createProfileActionExpression(actionId, prepared)
        );
      }
    );

    return {
      runNumber,
      browserUrl: config.browserUrl,
      url: profileUrl,
      traceOutputPath: writeTraceIfAvailable(trace, traceOutputPath),
      page: pageSummary,
      trace: summarizeTrace(trace, pageSummary),
      cpuProfile: summarizeCpuProfile(cpuProfile),
    };
  } finally {
    cdp.close();
    await closePageTarget(config.browserUrl, target.id, config.timeoutMs);
  }
}

function formatPhaseLabel(name: string): string {
  switch (name) {
    case 'page.createStore':
      return 'Create store';
    case 'page.renderWindow':
      return 'Render window';
    case 'page.renderWindow.getViewContext':
      return '  - Read visible window';
    case 'page.renderWindow.joinRowsText':
      return '  - Join rows text';
    case 'page.renderWindow.setTextContent':
      return '  - Set text content';
    case 'page.action.run':
      return 'Run action';
    case 'page.action.renderWindow':
      return 'Render action window';
    case 'store.builder.create':
      return '  - Create builder';
    case 'store.preparePathEntries':
      return '  - Prepare path entries';
    case 'store.preparePathEntries.parse':
      return '    - Parse input paths';
    case 'store.preparePathEntries.sort':
      return '    - Sort prepared paths';
    case 'store.builder.appendPaths.parse':
      return '  - Parse presorted paths';
    case 'store.builder.appendPreparedPaths':
      return '  - Append prepared paths';
    case 'store.builder.appendPresortedPaths':
      return '  - Append presorted paths';
    case 'store.builder.computeSubtreeCounts':
      return '  - Compute subtree counts';
    case 'store.builder.finish':
      return '  - Finalize snapshot';
    case 'store.state.create':
      return '  - Create store state';
    case 'store.state.initializeExpandedPaths':
      return '  - Apply expanded paths';
    case 'store.state.initializeOpenVisibleCounts':
      return '  - Initialize open visible counts';
    case 'store.state.recomputeCounts':
      return '  - Recompute visible counts';
    case 'store.getVisibleCount':
      return '    - getVisibleCount';
    case 'store.getVisibleSlice':
      return '    - getVisibleSlice';
    case 'store.getVisibleSlice.selectFirstRow':
      return '      - Select first row';
    case 'store.getVisibleSlice.selectChildIndex':
      return '        - Select child index';
    case 'store.getVisibleSlice.advanceCursor':
      return '      - Advance cursor';
    case 'store.getVisibleSlice.materializeRow':
      return '      - Materialize row';
    case 'store.getVisibleSlice.flatten.resolveTerminalDirectory':
      return '        - Resolve flattened terminal';
    case 'store.getVisibleSlice.flatten.collectSegments':
      return '        - Collect flattened segments';
    case 'store.add':
      return '  - store.add';
    case 'store.remove':
      return '  - store.remove';
    case 'store.move':
      return '  - store.move';
    case 'store.expand':
      return '  - store.expand';
    case 'store.collapse':
      return '  - store.collapse';
    case 'store.markDirectoryUnloaded':
      return '  - store.markDirectoryUnloaded';
    case 'store.beginChildLoad':
      return '  - store.beginChildLoad';
    case 'store.applyChildPatch':
      return '  - store.applyChildPatch';
    case 'store.completeChildLoad':
      return '  - store.completeChildLoad';
    case 'store.failChildLoad':
      return '  - store.failChildLoad';
    case 'scheduler.enqueue':
      return '  - scheduler.enqueue';
    case 'scheduler.begin':
      return '  - scheduler.begin';
    case 'scheduler.createPatch':
      return '  - scheduler.createPatch';
    case 'scheduler.apply':
      return '  - scheduler.apply';
    case 'scheduler.complete':
      return '  - scheduler.complete';
    case 'scheduler.fail':
      return '  - scheduler.fail';
    case 'scheduler.cancel':
      return '  - scheduler.cancel';
    case 'scheduler.yield':
      return '  - scheduler.yield';
    case 'store.list':
      return '  - store.list';
    case 'store.events.record':
      return '    - Record event';
    case 'store.events.batch.merge':
      return '    - Merge batch invalidation';
    case 'store.events.batch.commit':
      return '    - Commit batch event';
    case 'store.events.emit':
      return '    - Emit listeners';
    case 'store.recomputeCountsUpwardFrom':
      return '    - Recompute counts upward';
    case 'store.recomputeNodeCounts':
      return '      - Recompute node counts';
    case 'store.recomputeNodeCounts.rebuildChildAggregates':
      return '        - Rebuild child aggregates';
    default:
      return name;
  }
}

function createPhaseRows(
  phases: NonNullable<PageProfileSummary['instrumentation']>['phases']
): Array<{
  label: string;
  phase: NonNullable<PageProfileSummary['instrumentation']>['phases'][number];
}> {
  const phaseByName = new Map(phases.map((phase) => [phase.name, phase]));
  const rows: Array<{
    label: string;
    phase: NonNullable<PageProfileSummary['instrumentation']>['phases'][number];
  }> = [];
  const consumedNames = new Set<string>();

  const pushPhase = (phaseName: string): void => {
    const phase = phaseByName.get(phaseName);
    if (phase == null) {
      return;
    }

    consumedNames.add(phaseName);
    rows.push({
      label: formatPhaseLabel(phaseName),
      phase,
    });
  };

  pushPhase('page.createStore');
  pushPhase('store.builder.create');
  pushPhase('store.preparePathEntries');
  pushPhase('store.preparePathEntries.parse');
  pushPhase('store.preparePathEntries.sort');
  pushPhase('store.builder.appendPaths.parse');
  pushPhase('store.builder.appendPreparedPaths');
  pushPhase('store.builder.finish');
  pushPhase('store.builder.computeSubtreeCounts');
  pushPhase('store.state.create');
  pushPhase('store.state.initializeExpandedPaths');
  pushPhase('store.state.recomputeCounts');

  pushPhase('page.renderWindow');
  pushPhase('page.renderWindow.getViewContext');
  pushPhase('store.getVisibleCount');
  pushPhase('store.getVisibleSlice');
  pushPhase('store.getVisibleSlice.selectFirstRow');
  pushPhase('store.getVisibleSlice.selectChildIndex');
  pushPhase('store.getVisibleSlice.materializeRow');
  pushPhase('store.getVisibleSlice.flatten.resolveTerminalDirectory');
  pushPhase('store.getVisibleSlice.flatten.collectSegments');
  pushPhase('store.getVisibleSlice.advanceCursor');
  pushPhase('page.renderWindow.joinRowsText');
  pushPhase('page.renderWindow.setTextContent');

  pushPhase('page.action.run');
  pushPhase('store.add');
  pushPhase('store.remove');
  pushPhase('store.move');
  pushPhase('store.expand');
  pushPhase('store.collapse');
  pushPhase('store.markDirectoryUnloaded');
  pushPhase('store.beginChildLoad');
  pushPhase('store.applyChildPatch');
  pushPhase('store.completeChildLoad');
  pushPhase('store.failChildLoad');
  pushPhase('scheduler.enqueue');
  pushPhase('scheduler.begin');
  pushPhase('scheduler.createPatch');
  pushPhase('scheduler.apply');
  pushPhase('scheduler.complete');
  pushPhase('scheduler.fail');
  pushPhase('scheduler.cancel');
  pushPhase('scheduler.yield');
  pushPhase('store.events.record');
  pushPhase('store.events.batch.merge');
  pushPhase('store.events.batch.commit');
  pushPhase('store.events.emit');
  pushPhase('store.recomputeCountsUpwardFrom');
  pushPhase('store.recomputeNodeCounts');
  pushPhase('store.recomputeNodeCounts.rebuildChildAggregates');
  pushPhase('store.list');
  pushPhase('page.action.renderWindow');

  const remainingPhases = phases
    .filter((phase) => !consumedNames.has(phase.name))
    .sort((left, right) => {
      if (right.durationMs !== left.durationMs) {
        return right.durationMs - left.durationMs;
      }
      return left.name.localeCompare(right.name);
    });

  for (const phase of remainingPhases) {
    rows.push({
      label: formatPhaseLabel(phase.name),
      phase,
    });
  }

  return rows;
}

function printRunHumanSummary(
  result: ProfileRunResult,
  totalRuns: number,
  showDominantTraceEvents: boolean
): void {
  const summaryRows = [
    ['Rendered rows', String(result.page.renderedRowCount)],
    ['Window size', String(result.page.requestedVisibleCount)],
    ['Visible rows ready', formatMs(result.page.visibleRowsReadyMs)],
    ['Post-paint ready', formatMs(result.page.postPaintReadyMs)],
    ['Total visible rows', formatCount(result.page.visibleCount)],
    ['Window offset', formatCount(result.page.windowOffset)],
  ];

  if (result.page.beforeVisibleCount != null) {
    summaryRows.push([
      'Visible rows before',
      formatCount(result.page.beforeVisibleCount),
    ]);
    summaryRows.push([
      'Visible rows delta',
      formatCount(result.page.visibleCount - result.page.beforeVisibleCount),
    ]);
  }

  if (result.page.longTaskCount > 0) {
    summaryRows.push([
      'Long task count',
      formatCount(result.page.longTaskCount),
    ]);
    summaryRows.push([
      'Long task total',
      formatMs(result.page.longTaskTotalMs),
    ]);
    summaryRows.push([
      'Longest long task',
      formatMs(result.page.longestLongTaskMs),
    ]);
  }

  if (result.trace.available) {
    summaryRows.push(['Trace window', formatMs(result.trace.windowDurationMs)]);
    summaryRows.push([
      'Main-thread busy',
      formatMs(result.trace.mainThreadBusyMs),
    ]);
    summaryRows.push([
      'Longest top-level task',
      formatMs(result.trace.longestTaskMs),
    ]);
    summaryRows.push([
      'Top-level task count',
      formatCount(result.trace.topLevelTaskCount),
    ]);
    summaryRows.push(['GC time', formatMs(result.trace.gcMs)]);
    summaryRows.push([
      'Style/layout time',
      formatMs(result.trace.styleLayoutMs),
    ]);
    summaryRows.push([
      'Paint/composite time',
      formatMs(result.trace.paintCompositeMs),
    ]);
  } else {
    summaryRows.push(['Trace summary', 'unavailable']);
  }

  console.log(`Run ${result.runNumber}/${totalRuns}`);
  console.log(
    createTable(['Metric', 'Value'], summaryRows, {
      alignments: ['left', 'right'],
      maxWidths: [24, 22],
    })
  );

  const phaseRows = createPhaseRows(result.page.instrumentation?.phases ?? []);
  if (phaseRows.length > 0) {
    console.log('');
    console.log('Phases');
    console.log('Total includes nested child phases. Own excludes them.');
    console.log(
      createTable(
        ['Phase', 'Total', 'Own', 'Own %', 'Calls'],
        phaseRows.map(({ label, phase }) => [
          label,
          formatMs(phase.durationMs),
          formatMs(phase.selfDurationMs),
          result.page.postPaintReadyMs <= 0
            ? 'n/a'
            : formatPercent(
                Number(
                  (
                    (phase.selfDurationMs / result.page.postPaintReadyMs) *
                    100
                  ).toFixed(1)
                )
              ),
          formatCount(phase.count),
        ]),
        {
          alignments: ['left', 'right', 'right', 'right', 'right'],
          maxWidths: [36, 12, 12, 9, 8],
        }
      )
    );
  }

  if (result.page.instrumentation?.heap != null) {
    console.log('');
    console.log('Heap');
    console.log(
      createTable(
        ['Metric', 'Value'],
        [
          [
            'Used JS heap before',
            formatBytes(
              result.page.instrumentation.heap.usedJSHeapSizeBeforeBytes
            ),
          ],
          [
            'Used JS heap after',
            formatBytes(
              result.page.instrumentation.heap.usedJSHeapSizeAfterBytes
            ),
          ],
          [
            'Used JS heap delta',
            formatBytes(
              result.page.instrumentation.heap.usedJSHeapSizeDeltaBytes
            ),
          ],
          [
            'Total JS heap after',
            formatBytes(
              result.page.instrumentation.heap.totalJSHeapSizeAfterBytes
            ),
          ],
          [
            'JS heap limit',
            formatBytes(result.page.instrumentation.heap.jsHeapSizeLimitBytes),
          ],
        ],
        {
          alignments: ['left', 'right'],
          maxWidths: [24, 18],
        }
      )
    );
  }

  const instrumentationCounters = result.page.instrumentation?.counters ?? {};
  const counterDefinitions = [
    ['Input files', instrumentationCounters['workload.inputFiles']],
    ['Expanded folders', instrumentationCounters['workload.expandedFolders']],
    ['Rendered rows', instrumentationCounters['workload.renderedRows']],
    ['Visible rows read', instrumentationCounters['workload.visibleRowsRead']],
    [
      'Total visible rows',
      instrumentationCounters['workload.totalVisibleRows'],
    ],
    [
      'Flattened rows read',
      instrumentationCounters['workload.flattenedRowsRead'],
    ],
    [
      'Flattened segments read',
      instrumentationCounters['workload.flattenedSegmentsRead'],
    ],
    ['Scheduler queue depth', instrumentationCounters['scheduler.queueDepth']],
    [
      'Scheduler active tasks',
      instrumentationCounters['scheduler.activeTaskCount'],
    ],
    [
      'Scheduler completed tasks',
      instrumentationCounters['scheduler.completedTaskCount'],
    ],
    [
      'Scheduler cancelled tasks',
      instrumentationCounters['scheduler.cancelledTaskCount'],
    ],
    [
      'Scheduler failed tasks',
      instrumentationCounters['scheduler.failedTaskCount'],
    ],
    [
      'Scheduler rejected tasks',
      instrumentationCounters['scheduler.rejectedTaskCount'],
    ],
    ['Scheduler yields', instrumentationCounters['scheduler.yieldCount']],
  ].filter(([, value]) => typeof value === 'number') as Array<[string, number]>;

  if (counterDefinitions.length > 0) {
    console.log('');
    console.log('Counters');
    console.log(
      createTable(
        ['Metric', 'Value'],
        counterDefinitions.map(([label, value]) => [label, formatCount(value)]),
        {
          alignments: ['left', 'right'],
          maxWidths: [28, 18],
        }
      )
    );
  }

  if (
    showDominantTraceEvents &&
    result.trace.available &&
    result.trace.dominantEvents.length > 0
  ) {
    console.log('');
    console.log('Dominant Trace Events (Lower Signal)');
    console.log(
      createTable(
        ['Event', 'Time', 'Window %'],
        result.trace.dominantEvents.map((event) => [
          event.name,
          formatMs(event.durationMs),
          formatPercent(event.percentOfWindow),
        ]),
        {
          alignments: ['left', 'right', 'right'],
          maxWidths: [42, 12, 10],
        }
      )
    );
  }

  if (result.cpuProfile.available) {
    console.log('');
    console.log('CPU Summary');
    console.log(
      createTable(
        ['Metric', 'Value'],
        [
          ['Sampled CPU around action', formatMs(result.cpuProfile.sampledMs)],
          ['Samples', formatCount(result.cpuProfile.sampleCount)],
        ],
        {
          alignments: ['left', 'right'],
          maxWidths: [28, 18],
        }
      )
    );

    if (result.cpuProfile.bottomUpFunctions.length > 0) {
      console.log('');
      console.log('Bottom-Up CPU');
      console.log(
        createTable(
          ['Function', 'Self', 'Self %', 'Total', 'Total %'],
          result.cpuProfile.bottomUpFunctions.map((functionSummary) => [
            functionSummary.name,
            formatMs(functionSummary.selfMs),
            formatPercent(functionSummary.selfPercent),
            formatMs(functionSummary.totalMs),
            formatPercent(functionSummary.totalPercent),
          ]),
          {
            alignments: ['left', 'right', 'right', 'right', 'right'],
            maxWidths: [78, 12, 9, 12, 9],
          }
        )
      );
    }
  }

  if (result.traceOutputPath != null) {
    console.log('');
    console.log(`Trace file: ${result.traceOutputPath}`);
  }
}

function printAggregateHumanSummary(
  summary: JsonAggregateSummary,
  measuredRuns: number
): void {
  const aggregateRows = AGGREGATE_METRIC_DEFINITIONS.map((definition) => {
    return summary.metrics[definition.key];
  });

  console.log('Aggregate Summary');
  console.log(
    createTable(
      ['Metric', 'Total', 'Average', 'Median', 'P95', 'Runs'],
      aggregateRows.map((row) => [
        row.label,
        formatMs(row.totalMs),
        formatMs(row.averageMs),
        formatMs(row.medianMs),
        formatMs(row.p95Ms),
        `${row.availableRuns}/${measuredRuns}`,
      ]),
      {
        alignments: ['left', 'right', 'right', 'right', 'right', 'right'],
        maxWidths: [28, 14, 14, 14, 14, 8],
      }
    )
  );
}

function printScenarioHumanSummary(
  scenarioOutput: ProfileScenarioOutput,
  config: ProfileConfigSummary
): void {
  const scenarioRows = [
    [
      'Workload',
      `${scenarioOutput.scenario.workload.label} (${scenarioOutput.scenario.workload.name})`,
    ],
    [
      'Action',
      `${scenarioOutput.scenario.action.label} (${scenarioOutput.scenario.action.id})`,
    ],
    ['Files', formatCount(scenarioOutput.scenario.workload.fileCount)],
    [
      'Expanded folders',
      formatCount(scenarioOutput.scenario.workload.expandedFolderCount),
    ],
    [
      'Flatten directories',
      scenarioOutput.scenario.workload.flattenEmptyDirectories ? 'on' : 'off',
    ],
    ['Window size', formatCount(config.visibleCount)],
    ['Offset', formatCount(config.offset)],
    ['Measured runs', String(scenarioOutput.runs.length)],
    ['Warmup runs', String(config.warmupRuns)],
  ];

  console.log('Scenario');
  console.log(
    createTable(['Field', 'Value'], scenarioRows, {
      maxWidths: [18, 96],
    })
  );

  for (const [index, result] of scenarioOutput.runs.entries()) {
    console.log('');
    printRunHumanSummary(
      result,
      scenarioOutput.runs.length,
      config.showDominantTraceEvents
    );
    if (index < scenarioOutput.runs.length - 1) {
      console.log('');
    }
  }

  if (scenarioOutput.runs.length > 1) {
    console.log('');
    printAggregateHumanSummary(
      scenarioOutput.summary,
      scenarioOutput.runs.length
    );
  }
}

function printRunsHumanSummary(output: ProfileBenchmarkOutput): void {
  if (output.scenarios.length === 0) {
    return;
  }

  const runInfoRows = [
    ['Browser', output.config.browserUrl],
    ['URL', output.config.url],
    ['Workloads', output.config.workloads.join(', ')],
    ['Actions', output.config.actions.join(', ')],
    ['Window size', formatCount(output.config.visibleCount)],
    ['Offset', formatCount(output.config.offset)],
    ['Measured runs/scenario', String(output.config.runs)],
    ['Warmup runs/scenario', String(output.config.warmupRuns)],
    ['Instrumentation', output.config.instrumentationMode],
    [
      'Dominant trace events',
      output.config.showDominantTraceEvents ? 'on (lower-signal)' : 'hidden',
    ],
  ];

  console.log('Benchmark');
  console.log(
    createTable(['Field', 'Value'], runInfoRows, {
      maxWidths: [22, 96],
    })
  );

  for (const [index, scenarioOutput] of output.scenarios.entries()) {
    console.log('');
    printScenarioHumanSummary(scenarioOutput, output.config);
    if (index < output.scenarios.length - 1) {
      console.log('');
    }
  }
}

async function runScenarioProfile(
  config: ProfileConfig,
  workloadName: string,
  actionId: string,
  totalScenarios: number
): Promise<ProfileScenarioOutput> {
  const results: ProfileRunResult[] = [];

  for (
    let warmupRunNumber = 1;
    warmupRunNumber <= config.warmupRuns;
    warmupRunNumber += 1
  ) {
    await profileDemoScenario(
      config,
      workloadName,
      actionId,
      warmupRunNumber,
      totalScenarios,
      null
    );
  }

  for (let runNumber = 1; runNumber <= config.runs; runNumber += 1) {
    const traceOutputPath = createRunTraceOutputPath(
      config.traceOutputPath,
      workloadName,
      actionId,
      totalScenarios,
      runNumber,
      config.runs
    );
    const result = await profileDemoScenario(
      config,
      workloadName,
      actionId,
      runNumber,
      totalScenarios,
      traceOutputPath
    );
    results.push(result);
  }

  return createScenarioOutput(results);
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  let serverProcess: Bun.Subprocess | null = null;

  try {
    serverProcess = await startDemoServerIfNeeded(config);

    const totalScenarios = config.workloads.length * config.actions.length;
    const scenarios: ProfileScenarioOutput[] = [];
    for (const workloadName of config.workloads) {
      for (const actionId of config.actions) {
        scenarios.push(
          await runScenarioProfile(
            config,
            workloadName,
            actionId,
            totalScenarios
          )
        );
      }
    }

    const output: ProfileBenchmarkOutput = {
      benchmark: 'pathStoreDemoProfile',
      config: createProfileConfigSummary(config),
      scenarios,
    };

    if (config.outputJson) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printRunsHumanSummary(output);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}\n\nRun Chrome with remote debugging first, for example:\n/Applications/Google\\ Chrome\\ Dev.app/Contents/MacOS/Google\\ Chrome\\ Dev --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-devtools-codex`
    );
  } finally {
    serverProcess?.kill();
  }
}

await main();
