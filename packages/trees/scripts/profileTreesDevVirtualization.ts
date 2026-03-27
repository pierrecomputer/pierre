import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ProfileConfig {
  browserUrl: string;
  url: string;
  workloads: string[];
  timeoutMs: number;
  runs: number;
  warmupRuns: number;
  instrumentationMode: 'on' | 'off';
  includeCallCounts: boolean;
  showDominantTraceEvents: boolean;
  outputJson: boolean;
  comparePath?: string;
  traceOutputPath: string;
  ensureBuild: boolean;
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
  id2?: {
    local?: string;
  };
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

interface PageBenchmarkPhase {
  name: string;
  durationMs: number;
  selfDurationMs: number;
  count: number;
}

interface PageHeapSummary {
  usedJSHeapSizeBeforeBytes: number;
  usedJSHeapSizeAfterBytes: number;
  usedJSHeapSizeDeltaBytes: number;
  totalJSHeapSizeAfterBytes: number;
  jsHeapSizeLimitBytes: number;
}

interface PageInstrumentationSummary {
  phases: PageBenchmarkPhase[];
  counters: Record<string, number>;
  heap: PageHeapSummary | null;
}

interface PageWorkloadSummary {
  name: string;
  label: string;
  fileCount: number;
  expandedFolderCount: number;
}

interface PageRenderSummary {
  workload?: PageWorkloadSummary;
  renderedItemCount: number;
  visibleRowsReadyMs?: number;
  renderDurationMs: number;
  longTaskCount?: number;
  longTaskTotalMs?: number;
  longestLongTaskMs?: number;
  instrumentation?: PageInstrumentationSummary | null;
  resultText?: string | null;
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
  clickDispatchMs: number | null;
  clickToRenderReadyMs: number | null;
  mainThreadBusyMs: number | null;
  longestTaskMs: number | null;
  topLevelTaskCount: number | null;
  overlappingScriptingSlicesMs: number | null;
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
  callCount: number | null;
}

interface CpuProfileSummary {
  available: boolean;
  sampleCount: number | null;
  sampledMs: number | null;
  bottomUpFunctions: BottomUpFunctionSummary[];
}

interface InstrumentedPhaseSummary {
  name: string;
  durationMs: number;
  selfDurationMs: number;
  count: number;
  percentOfRender: number | null;
  selfPercentOfRender: number | null;
  workload: string | null;
}

interface HeapSummary {
  available: boolean;
  usedJSHeapSizeBeforeBytes: number | null;
  usedJSHeapSizeAfterBytes: number | null;
  usedJSHeapSizeDeltaBytes: number | null;
  totalJSHeapSizeAfterBytes: number | null;
  jsHeapSizeLimitBytes: number | null;
}

interface ProfileResult {
  runNumber: number;
  browserUrl: string;
  url: string;
  workload: PageWorkloadSummary;
  traceOutputPath: string | null;
  renderedItemCount: number;
  visibleRowsReadyMs: number | null;
  renderDurationMs: number;
  longTaskCount: number | null;
  longTaskTotalMs: number | null;
  longestLongTaskMs: number | null;
  instrumentation: {
    phases: InstrumentedPhaseSummary[];
    counters: Record<string, number>;
    heap: HeapSummary;
  };
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
  | 'clickDispatchMs'
  | 'clickToRenderReadyMs'
  | 'traceWindowMs'
  | 'mainThreadBusyMs'
  | 'longestTopLevelTaskMs'
  | 'sampledCpuTimeMs';

interface JsonAggregateSummary {
  measuredRuns: number;
  metrics: Record<AggregateMetricKey, AggregateMetricSummary>;
}

interface ProfileWorkloadOutput {
  workload: PageWorkloadSummary;
  runs: ProfileResult[];
  summary: JsonAggregateSummary;
}

interface ProfileConfigSummary {
  browserUrl: string;
  url: string;
  workloads: string[];
  timeoutMs: number;
  runs: number;
  warmupRuns: number;
  instrumentationMode: 'on' | 'off';
  includeCallCounts: boolean;
  showDominantTraceEvents: boolean;
}

interface MetricComparisonSummary {
  label: string;
  availableRuns: {
    baseline: number;
    current: number;
  };
  averageMs: {
    baseline: number | null;
    current: number | null;
    deltaMs: number | null;
    deltaPct: number | null;
  };
  medianMs: {
    baseline: number | null;
    current: number | null;
    deltaMs: number | null;
    deltaPct: number | null;
  };
  p95Ms: {
    baseline: number | null;
    current: number | null;
    deltaMs: number | null;
    deltaPct: number | null;
  };
}

interface WorkloadComparisonSummary {
  workload: PageWorkloadSummary;
  baselineWorkload: PageWorkloadSummary;
  workloadShapeMatches: boolean;
  metrics: Record<AggregateMetricKey, MetricComparisonSummary>;
}

interface ProfileComparisonSummary {
  baselinePath: string;
  unmatchedBaselineWorkloads: string[];
  unmatchedCurrentWorkloads: string[];
  workloads: WorkloadComparisonSummary[];
}

interface ProfileBenchmarkOutput {
  benchmark: 'virtualizationProfile';
  config: ProfileConfigSummary;
  workloads: ProfileWorkloadOutput[];
  comparison?: ProfileComparisonSummary;
}

interface InspectVersionResponse {
  Browser: string;
  ProtocolVersion: string;
  webSocketDebuggerUrl: string;
}

interface NewTargetResponse {
  id: string;
  webSocketDebuggerUrl: string;
}

interface CpuProfileNodeCallFrame {
  functionName: string;
  url: string;
  lineNumber?: number;
  columnNumber?: number;
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

interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

interface FunctionCoverage {
  functionName: string;
  ranges: CoverageRange[];
}

interface ScriptCoverage {
  scriptId: string;
  url: string;
  functions: FunctionCoverage[];
}

interface RuntimeEvaluateResult<TValue> {
  result?: {
    value?: TValue;
    description?: string;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
      value?: string;
    };
  };
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

declare global {
  interface Window {
    __treesDevVirtualizationFixtureReady?: boolean;
    __treesDevVirtualizationProfile?: PageRenderSummary;
  }
}

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_BROWSER_URL = 'http://127.0.0.1:9222';
const DEFAULT_URL =
  'http://127.0.0.1:9221/test/e2e/fixtures/virtualization.html';
const DEFAULT_WORKLOAD_NAME = 'linux-5x';
const KNOWN_WORKLOAD_NAMES = new Set([
  'pierre-snapshot',
  'half-linux',
  'linux',
  'linux-5x',
  'linux-10x',
]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RUN_COUNT = 1;
const DEFAULT_WARMUP_RUN_COUNT = 0;
const DEFAULT_TRACE_OUTPUT_DIR = resolve(tmpdir(), 'pierrejs-trees-traces');
const DEFAULT_TRACE_OUTPUT_EXAMPLE_PATH = resolve(
  DEFAULT_TRACE_OUTPUT_DIR,
  'trees-dev-virtualized-render-trace-<run-id>.json'
);
const START_MARK_NAME = 'trees-dev-virtualized-render-start';
const END_MARK_NAME = 'trees-dev-virtualized-render-end';
const START_TRACE_LABEL = 'trees-dev-virtualized-render-trace-start';
const END_TRACE_LABEL = 'trees-dev-virtualized-render-trace-end';
const MEASURE_NAME = 'trees-dev-virtualized-render-measure';
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
const TOP_LEVEL_TASK_NAMES = new Set([
  'RunTask',
  'ThreadControllerImpl::RunTask',
]);
const SCRIPT_EVENT_NAMES = new Set([
  'EventDispatch',
  'EvaluateScript',
  'FunctionCall',
  'V8.Execute',
  'TimerFire',
  'FireAnimationFrame',
  'RequestAnimationFrame',
  'RunMicrotasks',
  'v8.callFunction',
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
const CLICK_EVENT_TYPES = new Set(['click', 'DOMActivate']);
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
  'extensions::',
  'native ',
  'node:',
  'inspector://',
];
const MAJOR_PHASE_ORDER = [
  'root.fileListToTree',
  'root.pathToId',
  'root.stateConfig',
  'expandPathsWithAncestors',
  'root.dataLoader',
  'core.rebuildItemMeta',
  'fileTree.render.mount',
] as const;
const TREE_BUILD_PHASE_ORDER = [
  'fileListToTree.pathGraph',
  'fileListToTree.flattenedNodes',
  'fileListToTree.folderNodes',
  'fileListToTree.hashKeys',
] as const;
const AGGREGATE_METRIC_DEFINITIONS: Array<{
  key: AggregateMetricKey;
  label: string;
  select: (result: ProfileResult) => number | null;
}> = [
  {
    key: 'visibleRowsReadyMs',
    label: 'Visible rows ready',
    select: (result) => result.visibleRowsReadyMs,
  },
  {
    key: 'postPaintReadyMs',
    label: 'Post-paint ready',
    select: (result) => result.renderDurationMs,
  },
  {
    key: 'clickDispatchMs',
    label: 'Click dispatch task',
    select: (result) => result.trace.clickDispatchMs,
  },
  {
    key: 'clickToRenderReadyMs',
    label: 'Click-to-post-paint-ready',
    select: (result) => result.trace.clickToRenderReadyMs,
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
    key: 'sampledCpuTimeMs',
    label: 'Sampled CPU time',
    select: (result) => result.cpuProfile.sampledMs,
  },
];
const INTEGER_FORMATTER = new Intl.NumberFormat('en-US');

function printHelpAndExit(): never {
  console.log('Usage: bun ws trees profile:virtualization -- [options]');
  console.log('');
  console.log(
    'Assumes Chrome is already running with --remote-debugging-port enabled.'
  );
  console.log('');
  console.log('Options:');
  console.log(
    `  --browser-url <url>    Chrome remote debugging base URL (default: ${DEFAULT_BROWSER_URL})`
  );
  console.log(
    `  --url <url>            Page to profile (default: ${DEFAULT_URL})`
  );
  console.log(
    `  --workload <name>      Fixture workload to run (repeatable, default: ${DEFAULT_WORKLOAD_NAME})`
  );
  console.log(
    `  --timeout <ms>         Navigation/render timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`
  );
  console.log(
    `  --runs <count>         Number of benchmark runs to execute (default: ${DEFAULT_RUN_COUNT})`
  );
  console.log(
    `  --warmup-runs <count>  Number of warm-up runs to discard before reporting (default: ${DEFAULT_WARMUP_RUN_COUNT})`
  );
  console.log(
    '  --instrumentation <mode> Benchmark fixture instrumentation mode: on or off'
  );
  console.log(
    '  --call-counts         Run a second precise-coverage pass to annotate bottom-up functions with invocation counts'
  );
  console.log(
    '  --dominant-trace-events Show the lower-signal dominant trace event table in human output'
  );
  console.log(
    `  --trace-out <path>     Where to save the Chrome trace JSON when tracing succeeds (default: ${DEFAULT_TRACE_OUTPUT_EXAMPLE_PATH})`
  );
  console.log(
    '  --compare <path>       Compare against a prior --json virtualization profile run'
  );
  console.log(
    '  --no-build             Skip rebuilding @pierre/trees before profiling'
  );
  console.log(
    '  --no-server            Assume the fixture server is already running'
  );
  console.log('  --json                 Emit machine-readable JSON output');
  console.log('  -h, --help             Show this help output');
  process.exit(0);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flag} value '${value}'`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flag} value '${value}'`);
  }
  return parsed;
}

function parseInstrumentationMode(value: string): 'on' | 'off' {
  if (value === 'on' || value === 'off') {
    return value;
  }
  throw new Error(
    `Invalid --instrumentation value '${value}'. Expected 'on' or 'off'.`
  );
}

function parseWorkloadName(value: string): string {
  if (KNOWN_WORKLOAD_NAMES.has(value)) {
    return value;
  }

  throw new Error(
    `Invalid --workload value '${value}'. Expected one of: ${[
      ...KNOWN_WORKLOAD_NAMES,
    ].join(', ')}.`
  );
}

function createTraceRunId(): string {
  return `${new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`;
}

function createDefaultTraceOutputPath(): string {
  return resolve(
    DEFAULT_TRACE_OUTPUT_DIR,
    `trees-dev-virtualized-render-trace-${createTraceRunId()}.json`
  );
}

function createRunTraceOutputPath(
  traceOutputPath: string,
  workloadName: string,
  workloadCount: number,
  runNumber: number,
  totalRuns: number
): string {
  const suffixParts: string[] = [];
  if (workloadCount > 1) {
    const workloadSlug = workloadName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    suffixParts.push(workloadSlug.length > 0 ? workloadSlug : 'workload');
  }

  if (totalRuns > 1) {
    suffixParts.push(
      `run-${String(runNumber).padStart(String(totalRuns).length, '0')}`
    );
  }

  if (suffixParts.length === 0) {
    return traceOutputPath;
  }

  const runSuffix = `-${suffixParts.join('-')}`;
  const extensionIndex = traceOutputPath.lastIndexOf('.');
  if (extensionIndex <= 0) {
    return `${traceOutputPath}${runSuffix}`;
  }

  return `${traceOutputPath.slice(0, extensionIndex)}${runSuffix}${traceOutputPath.slice(extensionIndex)}`;
}

function isVirtualizationFixtureUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const defaultUrl = new URL(DEFAULT_URL);
    return parsedUrl.pathname === defaultUrl.pathname;
  } catch {
    return false;
  }
}

function createProfileUrl(
  url: string,
  instrumentationMode: 'on' | 'off',
  workloadName: string
): string {
  const parsedUrl = new URL(url);
  if (isVirtualizationFixtureUrl(url)) {
    if (!parsedUrl.searchParams.has('instrumentation')) {
      parsedUrl.searchParams.set(
        'instrumentation',
        instrumentationMode === 'on' ? '1' : '0'
      );
    }
    if (!parsedUrl.searchParams.has('workload')) {
      parsedUrl.searchParams.set('workload', workloadName);
    }
  }
  return parsedUrl.toString();
}

function parseArgs(argv: string[]): ProfileConfig {
  const config: ProfileConfig = {
    browserUrl: DEFAULT_BROWSER_URL,
    url: DEFAULT_URL,
    workloads: [DEFAULT_WORKLOAD_NAME],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    runs: DEFAULT_RUN_COUNT,
    warmupRuns: DEFAULT_WARMUP_RUN_COUNT,
    instrumentationMode: 'on',
    includeCallCounts: false,
    showDominantTraceEvents: false,
    outputJson: false,
    traceOutputPath: createDefaultTraceOutputPath(),
    ensureBuild: true,
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

    if (rawArg === '--call-counts') {
      config.includeCallCounts = true;
      continue;
    }

    if (rawArg === '--dominant-trace-events') {
      config.showDominantTraceEvents = true;
      continue;
    }

    if (rawArg === '--no-build') {
      config.ensureBuild = false;
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
      flag === '--timeout' ||
      flag === '--runs' ||
      flag === '--warmup-runs' ||
      flag === '--instrumentation' ||
      flag === '--trace-out' ||
      flag === '--compare'
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
      } else if (flag === '--timeout') {
        config.timeoutMs = parsePositiveInteger(value, '--timeout');
      } else if (flag === '--runs') {
        config.runs = parsePositiveInteger(value, '--runs');
      } else if (flag === '--warmup-runs') {
        config.warmupRuns = parseNonNegativeInteger(value, '--warmup-runs');
      } else if (flag === '--instrumentation') {
        config.instrumentationMode = parseInstrumentationMode(value);
      } else if (flag === '--compare') {
        config.comparePath = resolve(process.cwd(), value);
      } else {
        config.traceOutputPath = resolve(process.cwd(), value);
      }
      continue;
    }

    throw new Error(`Unknown argument: ${rawArg}`);
  }

  config.workloads = [...new Set(config.workloads)];
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

function summarizeAggregateMetric(
  label: string,
  results: ProfileResult[],
  selector: (result: ProfileResult) => number | null
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

function createProfileConfigSummary(
  config: ProfileConfig
): ProfileConfigSummary {
  return {
    browserUrl: config.browserUrl,
    url: config.url,
    workloads: [...config.workloads],
    timeoutMs: config.timeoutMs,
    runs: config.runs,
    warmupRuns: config.warmupRuns,
    instrumentationMode: config.instrumentationMode,
    includeCallCounts: config.includeCallCounts,
    showDominantTraceEvents: config.showDominantTraceEvents,
  };
}

function createWorkloadOutput(results: ProfileResult[]): ProfileWorkloadOutput {
  if (results.length === 0) {
    throw new Error('Cannot summarize an empty workload result set.');
  }

  return {
    workload: results[0].workload,
    runs: results,
    summary: createJsonAggregateSummary(results),
  };
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

function decodeOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
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

/** Builds dist output so the fixture always reflects the current tree implementation. */
function ensureProductionDistBuild(): void {
  const buildResult = Bun.spawnSync({
    cmd: ['bun', 'run', 'build'],
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENT: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (buildResult.exitCode !== 0) {
    const stdout = decodeOutput(buildResult.stdout);
    const stderr = decodeOutput(buildResult.stderr);
    throw new Error(
      [
        'Failed to build @pierre/trees before profiling.',
        stdout !== '' ? `stdout:\n${stdout}` : null,
        stderr !== '' ? `stderr:\n${stderr}` : null,
      ]
        .filter((value): value is string => value != null)
        .join('\n\n')
    );
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

async function startFixtureServerIfNeeded(
  config: ProfileConfig
): Promise<Bun.Subprocess | null> {
  const profileUrl = createProfileUrl(
    config.url,
    config.instrumentationMode,
    config.workloads[0] ?? DEFAULT_WORKLOAD_NAME
  );
  if (!config.ensureBuild && !config.ensureServer) {
    return null;
  }

  if (config.ensureBuild) {
    ensureProductionDistBuild();
  }

  if (!config.ensureServer) {
    return null;
  }

  if (await isUrlReachable(profileUrl, 1_000)) {
    return null;
  }

  const serverProcess = Bun.spawn({
    cmd: ['bun', 'run', 'test:e2e:server'],
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENT: '1',
    },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  try {
    await waitForUrl(profileUrl, config.timeoutMs);
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

function createUnavailableTraceSummary(): TraceSummary {
  return {
    available: false,
    windowSource: null,
    windowDurationMs: null,
    clickDispatchMs: null,
    clickToRenderReadyMs: null,
    mainThreadBusyMs: null,
    longestTaskMs: null,
    topLevelTaskCount: null,
    overlappingScriptingSlicesMs: null,
    gcMs: null,
    styleLayoutMs: null,
    paintCompositeMs: null,
    dominantEvents: [],
  };
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

function findWindowFromCompleteEvent(
  events: TraceEvent[],
  eventName: string,
  source: string
): TraceWindow | null {
  const completeEvent =
    events.find(
      (event) =>
        event.name === eventName &&
        event.ph === 'X' &&
        typeof event.ts === 'number' &&
        typeof event.dur === 'number'
    ) ?? null;
  if (completeEvent != null) {
    return {
      startTs: completeEvent.ts!,
      endTs: completeEvent.ts! + completeEvent.dur!,
      pid: completeEvent.pid,
      tid: completeEvent.tid,
      source,
    };
  }

  const beginEvents = events.filter(
    (event) =>
      event.name === eventName &&
      event.ph === 'b' &&
      typeof event.ts === 'number'
  );
  const endEvents = events.filter(
    (event) =>
      event.name === eventName &&
      event.ph === 'e' &&
      typeof event.ts === 'number'
  );

  for (const beginEvent of beginEvents) {
    const matchingEndEvent =
      endEvents.find((event) => {
        return (
          event.ts! >= beginEvent.ts! &&
          (beginEvent.pid == null || event.pid === beginEvent.pid) &&
          (beginEvent.tid == null || event.tid === beginEvent.tid) &&
          (beginEvent.id2?.local == null ||
            event.id2?.local == null ||
            event.id2.local === beginEvent.id2.local)
        );
      }) ?? null;
    if (matchingEndEvent == null) {
      continue;
    }

    return {
      startTs: beginEvent.ts!,
      endTs: matchingEndEvent.ts!,
      pid: beginEvent.pid,
      tid: beginEvent.tid,
      source,
    };
  }

  return null;
}

function findTraceInteractionEvent(
  events: TraceEvent[],
  window: TraceWindow | null
): TraceEvent | null {
  const candidates = events.filter((event) => {
    if (
      event.name !== 'EventDispatch' ||
      event.ph !== 'X' ||
      typeof event.ts !== 'number' ||
      typeof event.dur !== 'number'
    ) {
      return false;
    }

    const eventType = event.args?.data?.type;
    return eventType != null && CLICK_EVENT_TYPES.has(eventType);
  });

  if (candidates.length === 0) {
    return null;
  }

  const threadCandidates =
    window == null
      ? candidates
      : candidates.filter((event) => {
          return (
            (window.pid == null || event.pid === window.pid) &&
            (window.tid == null || event.tid === window.tid)
          );
        });
  const relevantCandidates =
    threadCandidates.length > 0 ? threadCandidates : candidates;

  if (window == null) {
    return relevantCandidates.sort((left, right) => {
      const leftPriority = left.args?.data?.type === 'click' ? 0 : 1;
      const rightPriority = right.args?.data?.type === 'click' ? 0 : 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return (right.dur ?? 0) - (left.dur ?? 0);
    })[0];
  }

  const overlapCandidates = relevantCandidates.filter((event) => {
    return (
      overlapDurationUs(event.ts!, event.dur!, window.startTs, window.endTs) > 0
    );
  });
  const candidatesNearWindow =
    overlapCandidates.length > 0 ? overlapCandidates : relevantCandidates;

  return candidatesNearWindow.sort((left, right) => {
    const leftPriority = left.args?.data?.type === 'click' ? 0 : 1;
    const rightPriority = right.args?.data?.type === 'click' ? 0 : 1;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftDistance = Math.abs(left.ts! - window.startTs);
    const rightDistance = Math.abs(right.ts! - window.startTs);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    return (right.dur ?? 0) - (left.dur ?? 0);
  })[0];
}

/** Finds the render window even when Chrome drops the explicit start timestamp marker. */
function findTraceWindow(
  events: TraceEvent[],
  pageSummary: PageRenderSummary
): TraceWindow | null {
  const explicitTraceWindow = findWindowFromMarkers(
    events,
    START_TRACE_LABEL,
    END_TRACE_LABEL,
    'trace-labels'
  );
  if (explicitTraceWindow != null) {
    return explicitTraceWindow;
  }

  const explicitUserTimingWindow = findWindowFromMarkers(
    events,
    START_MARK_NAME,
    END_MARK_NAME,
    'user-timing-marks'
  );
  if (explicitUserTimingWindow != null) {
    return explicitUserTimingWindow;
  }

  const renderDurationUs = Math.round(pageSummary.renderDurationMs * 1000);
  if (renderDurationUs > 0) {
    const endEvent =
      findMarkerEvent(events, END_TRACE_LABEL) ??
      findMarkerEvent(events, END_MARK_NAME);
    if (endEvent != null && typeof endEvent.ts === 'number') {
      return {
        startTs: endEvent.ts - renderDurationUs,
        endTs: endEvent.ts,
        pid: endEvent.pid,
        tid: endEvent.tid,
        source: 'trace-end+page-measure',
      };
    }

    const interactionEvent = findTraceInteractionEvent(events, null);
    if (interactionEvent != null) {
      return {
        startTs: interactionEvent.ts!,
        endTs: interactionEvent.ts! + renderDurationUs,
        pid: interactionEvent.pid,
        tid: interactionEvent.tid,
        source: 'input-dispatch+page-measure',
      };
    }
  }

  return findWindowFromCompleteEvent(
    events,
    MEASURE_NAME,
    'user-timing-measure'
  );
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
      durationMs: durationUs / 1000,
      percentOfWindow:
        windowDurationUs <= 0
          ? null
          : Number(((durationUs / windowDurationUs) * 100).toFixed(1)),
    }))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 5);
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

function createFunctionKey(functionName: string, url: string): string {
  return JSON.stringify([functionName.trim(), url]);
}

function createUnavailableCpuProfileSummary(): CpuProfileSummary {
  return {
    available: false,
    sampleCount: null,
    sampledMs: null,
    bottomUpFunctions: [],
  };
}

function buildFunctionCallCountMap(
  scripts: ScriptCoverage[]
): Map<string, number | null> {
  const totals = new Map<string, number>();
  const ambiguousKeys = new Set<string>();

  for (const script of scripts) {
    for (const fn of script.functions) {
      const key = createFunctionKey(fn.functionName, script.url);
      if (totals.has(key)) {
        ambiguousKeys.add(key);
      }

      const callCount = fn.ranges.reduce((maxCount, range) => {
        return Math.max(maxCount, range.count);
      }, 0);
      totals.set(key, (totals.get(key) ?? 0) + callCount);
    }
  }

  const result = new Map<string, number | null>();
  for (const [key, count] of totals.entries()) {
    result.set(key, ambiguousKeys.has(key) ? null : count);
  }
  return result;
}

function summarizeCpuProfile(
  profile: CpuProfile | null,
  callCountsByFunction: Map<string, number | null> | null
): CpuProfileSummary {
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
      callCount: number | null;
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
      callCount:
        callCountsByFunction?.get(
          createFunctionKey(node.callFrame.functionName, node.callFrame.url)
        ) ?? null,
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

  const sampledMs = Number((sampledUs / 1000).toFixed(3));
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
      callCount: entry.callCount,
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
    sampledMs,
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

function summarizeTrace(
  trace: TraceFile | null,
  pageSummary: PageRenderSummary
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

  const interactionEvent = findTraceInteractionEvent(trace.traceEvents, window);

  return {
    available: true,
    windowSource: window.source,
    windowDurationMs: (window.endTs - window.startTs) / 1000,
    clickDispatchMs:
      interactionEvent?.dur == null
        ? null
        : Number((interactionEvent.dur / 1000).toFixed(3)),
    clickToRenderReadyMs:
      interactionEvent?.ts == null
        ? null
        : Number(((window.endTs - interactionEvent.ts) / 1000).toFixed(3)),
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
    overlappingScriptingSlicesMs: Number(
      (sumNamedEventsUs(SCRIPT_EVENT_NAMES) / 1000).toFixed(3)
    ),
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
      new Set([
        ...TOP_LEVEL_TASK_NAMES,
        START_TRACE_LABEL,
        END_TRACE_LABEL,
        MEASURE_NAME,
      ])
    ),
  };
}

function createUnavailableHeapSummary(): HeapSummary {
  return {
    available: false,
    usedJSHeapSizeBeforeBytes: null,
    usedJSHeapSizeAfterBytes: null,
    usedJSHeapSizeDeltaBytes: null,
    totalJSHeapSizeAfterBytes: null,
    jsHeapSizeLimitBytes: null,
  };
}

function getCounterValue(
  counters: Record<string, number>,
  key: string
): number | null {
  const value = counters[key];
  return Number.isFinite(value) ? value : null;
}

function getPageWorkloadSummary(
  pageSummary: PageRenderSummary,
  url: string
): PageWorkloadSummary {
  if (pageSummary.workload != null) {
    return pageSummary.workload;
  }

  const workloadName =
    new URL(url).searchParams.get('workload') ?? 'custom-workload';
  return {
    name: workloadName,
    label: workloadName,
    fileCount: 0,
    expandedFolderCount: 0,
  };
}

function formatWorkloadPair(
  counters: Record<string, number>,
  key: string,
  suffix: string
): string | null {
  const value = getCounterValue(counters, key);
  return value == null ? null : `${formatCount(value)} ${suffix}`;
}

function joinWorkloadParts(parts: Array<string | null>): string | null {
  const availableParts = parts.filter(
    (part): part is string => part != null && part !== ''
  );
  return availableParts.length === 0 ? null : availableParts.join(', ');
}

function formatWorkloadRate(
  numerator: number | null,
  denominator: number | null,
  label: string
): string | null {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }

  return `${((numerator / denominator) * 100).toFixed(1)}% ${label}`;
}

function formatPhaseWorkload(
  name: string,
  counters: Record<string, number>,
  renderedItemCount: number
): string | null {
  switch (name) {
    case 'root.fileListToTree': {
      return joinWorkloadParts([
        formatWorkloadPair(counters, 'workload.inputFiles', 'files'),
        formatWorkloadPair(counters, 'workload.treeNodes', 'nodes'),
      ]);
    }
    case 'fileListToTree.pathGraph': {
      const totalSegments = getCounterValue(
        counters,
        'workload.inputPathSegments'
      );
      const reusedSegments = getCounterValue(
        counters,
        'workload.pathGraphReusedPrefixSegments'
      );
      return joinWorkloadParts([
        formatWorkloadPair(counters, 'workload.inputFiles', 'files'),
        formatWorkloadPair(counters, 'workload.inputPathSegments', 'segments'),
        formatWorkloadRate(reusedSegments, totalSegments, 'prefix reuse'),
        formatWorkloadPair(counters, 'workload.pathGraphFolders', 'folders'),
      ]);
    }
    case 'fileListToTree.flattenedNodes': {
      return joinWorkloadParts([
        formatWorkloadPair(
          counters,
          'workload.flattenedNodes',
          'flattened nodes'
        ),
        formatWorkloadPair(
          counters,
          'workload.intermediateFlattenedFolders',
          'intermediate folders'
        ),
      ]);
    }
    case 'fileListToTree.folderNodes': {
      return formatWorkloadPair(counters, 'workload.folderNodes', 'folders');
    }
    case 'fileListToTree.hashKeys':
    case 'root.dataLoader': {
      if (name === 'root.dataLoader') {
        return formatWorkloadPair(counters, 'workload.treeNodes', 'nodes');
      }

      const resolveIdCalls = getCounterValue(
        counters,
        'workload.hashKeysResolveIdCalls'
      );
      const resolveIdCacheHits = getCounterValue(
        counters,
        'workload.hashKeysResolveIdCacheHits'
      );
      return joinWorkloadParts([
        formatWorkloadPair(counters, 'workload.treeNodes', 'nodes'),
        resolveIdCalls == null ? null : `${formatCount(resolveIdCalls)} remaps`,
        formatWorkloadRate(resolveIdCacheHits, resolveIdCalls, 'cache hits'),
      ]);
    }
    case 'root.pathToId': {
      return formatWorkloadPair(
        counters,
        'workload.pathToIdEntries',
        'entries'
      );
    }
    case 'root.stateConfig': {
      return joinWorkloadParts([
        (() => {
          const inputCount = getCounterValue(
            counters,
            'workload.state.initialExpandedPaths'
          );
          const outputCount = getCounterValue(
            counters,
            'workload.state.initialExpandedIds'
          );
          if (inputCount == null && outputCount == null) {
            return null;
          }
          return `${formatCount(inputCount)} expanded paths -> ${formatCount(outputCount)} ids`;
        })(),
      ]);
    }
    case 'expandPathsWithAncestors': {
      const pathCacheHits = getCounterValue(
        counters,
        'workload.expandPathsPathCacheHits'
      );
      const pathCacheMisses = getCounterValue(
        counters,
        'workload.expandPathsPathCacheMisses'
      );
      const ancestorCacheHits = getCounterValue(
        counters,
        'workload.expandPathsAncestorCacheHits'
      );
      const ancestorCacheMisses = getCounterValue(
        counters,
        'workload.expandPathsAncestorCacheMisses'
      );
      return (() => {
        const inputCount = getCounterValue(
          counters,
          'workload.expandPathsInputCount'
        );
        const outputCount = getCounterValue(
          counters,
          'workload.expandPathsResolvedIds'
        );
        if (inputCount == null && outputCount == null) {
          return null;
        }
        return joinWorkloadParts([
          `${formatCount(inputCount)} paths -> ${formatCount(outputCount)} ids`,
          formatWorkloadRate(
            pathCacheHits,
            pathCacheHits != null && pathCacheMisses != null
              ? pathCacheHits + pathCacheMisses
              : null,
            'path cache hits'
          ),
          formatWorkloadRate(
            ancestorCacheHits,
            ancestorCacheHits != null && ancestorCacheMisses != null
              ? ancestorCacheHits + ancestorCacheMisses
              : null,
            'ancestor cache hits'
          ),
        ]);
      })();
    }
    case 'core.rebuildItemMeta': {
      return formatWorkloadPair(
        counters,
        'workload.visibleItemMeta',
        'visible items'
      );
    }
    case 'fileTree.render.mount': {
      return `${formatCount(renderedItemCount)} visible rows`;
    }
    default: {
      return null;
    }
  }
}

function formatPhaseLabel(name: string): string {
  switch (name) {
    case 'root.fileListToTree':
      return 'Build tree data';
    case 'root.pathToId':
      return 'Map paths to ids';
    case 'root.stateConfig':
      return 'Derive tree state';
    case 'expandPathsWithAncestors':
      return 'Resolve expanded ancestors';
    case 'root.dataLoader':
      return 'Create data loader';
    case 'core.rebuildItemMeta':
      return 'Rebuild item metadata';
    case 'fileTree.render.mount':
      return 'Mount Preact tree';
    case 'fileListToTree.pathGraph':
      return 'Build path graph';
    case 'fileListToTree.flattenedNodes':
      return 'Build flattened nodes';
    case 'fileListToTree.folderNodes':
      return 'Build folder nodes';
    case 'fileListToTree.hashKeys':
      return 'Hash node ids';
    default:
      return name;
  }
}

function summarizeInstrumentation(
  pageSummary: PageRenderSummary
): ProfileResult['instrumentation'] {
  const counters = pageSummary.instrumentation?.counters ?? {};
  const phases = (pageSummary.instrumentation?.phases ?? [])
    .map((phase) => ({
      name: phase.name,
      durationMs: Number(phase.durationMs.toFixed(3)),
      selfDurationMs: Number(phase.selfDurationMs.toFixed(3)),
      count: phase.count,
      percentOfRender:
        pageSummary.renderDurationMs <= 0
          ? null
          : Number(
              ((phase.durationMs / pageSummary.renderDurationMs) * 100).toFixed(
                1
              )
            ),
      selfPercentOfRender:
        pageSummary.renderDurationMs <= 0
          ? null
          : Number(
              (
                (phase.selfDurationMs / pageSummary.renderDurationMs) *
                100
              ).toFixed(1)
            ),
      workload: formatPhaseWorkload(
        phase.name,
        counters,
        pageSummary.renderedItemCount
      ),
    }))
    .sort((left, right) => {
      const majorLeftIndex = MAJOR_PHASE_ORDER.indexOf(
        left.name as (typeof MAJOR_PHASE_ORDER)[number]
      );
      const majorRightIndex = MAJOR_PHASE_ORDER.indexOf(
        right.name as (typeof MAJOR_PHASE_ORDER)[number]
      );
      if (majorLeftIndex !== -1 || majorRightIndex !== -1) {
        if (majorLeftIndex === -1) {
          return 1;
        }
        if (majorRightIndex === -1) {
          return -1;
        }
        return majorLeftIndex - majorRightIndex;
      }

      const treeLeftIndex = TREE_BUILD_PHASE_ORDER.indexOf(
        left.name as (typeof TREE_BUILD_PHASE_ORDER)[number]
      );
      const treeRightIndex = TREE_BUILD_PHASE_ORDER.indexOf(
        right.name as (typeof TREE_BUILD_PHASE_ORDER)[number]
      );
      if (treeLeftIndex !== -1 || treeRightIndex !== -1) {
        if (treeLeftIndex === -1) {
          return 1;
        }
        if (treeRightIndex === -1) {
          return -1;
        }
        return treeLeftIndex - treeRightIndex;
      }

      if (right.durationMs !== left.durationMs) {
        return right.durationMs - left.durationMs;
      }
      return left.name.localeCompare(right.name);
    });

  const rawHeap = pageSummary.instrumentation?.heap;
  const heap =
    rawHeap == null
      ? createUnavailableHeapSummary()
      : {
          available: true,
          usedJSHeapSizeBeforeBytes: rawHeap.usedJSHeapSizeBeforeBytes,
          usedJSHeapSizeAfterBytes: rawHeap.usedJSHeapSizeAfterBytes,
          usedJSHeapSizeDeltaBytes: rawHeap.usedJSHeapSizeDeltaBytes,
          totalJSHeapSizeAfterBytes: rawHeap.totalJSHeapSizeAfterBytes,
          jsHeapSizeLimitBytes: rawHeap.jsHeapSizeLimitBytes,
        };

  return {
    phases,
    counters,
    heap,
  };
}

function createNestedPhaseRows(phases: InstrumentedPhaseSummary[]): Array<{
  label: string;
  phase: InstrumentedPhaseSummary;
}> {
  const phaseByName = new Map(phases.map((phase) => [phase.name, phase]));
  const rows: Array<{
    label: string;
    phase: InstrumentedPhaseSummary;
  }> = [];
  const consumedNames = new Set<string>();

  const pushPhase = (phaseName: string, label: string): void => {
    const phase = phaseByName.get(phaseName);
    if (phase == null) {
      return;
    }

    consumedNames.add(phaseName);
    rows.push({ label, phase });
  };

  pushPhase('root.fileListToTree', formatPhaseLabel('root.fileListToTree'));
  for (const childPhaseName of TREE_BUILD_PHASE_ORDER) {
    pushPhase(childPhaseName, `  - ${formatPhaseLabel(childPhaseName)}`);
  }

  pushPhase('root.pathToId', formatPhaseLabel('root.pathToId'));
  pushPhase('root.stateConfig', formatPhaseLabel('root.stateConfig'));
  pushPhase(
    'expandPathsWithAncestors',
    `  - ${formatPhaseLabel('expandPathsWithAncestors')}`
  );
  pushPhase('root.dataLoader', formatPhaseLabel('root.dataLoader'));
  pushPhase('core.rebuildItemMeta', formatPhaseLabel('core.rebuildItemMeta'));
  pushPhase('fileTree.render.mount', formatPhaseLabel('fileTree.render.mount'));

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

async function startPreciseCoverage(cdp: CdpClient): Promise<void> {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.startPreciseCoverage', {
    callCount: true,
    detailed: false,
  });
}

async function stopPreciseCoverage(
  cdp: CdpClient
): Promise<ScriptCoverage[] | null> {
  try {
    const response = await cdp.send<{ result?: ScriptCoverage[] }>(
      'Profiler.takePreciseCoverage'
    );
    return response.result ?? null;
  } finally {
    await cdp.send('Profiler.stopPreciseCoverage').catch(() => {});
    await cdp.send('Profiler.disable').catch(() => {});
  }
}

async function navigateToFixture(
  cdp: CdpClient,
  url: string,
  timeoutMs: number
): Promise<void> {
  const loadEvent = cdp.once('Page.loadEventFired', timeoutMs);
  await cdp.send('Page.navigate', { url });
  await loadEvent;

  const ready = await evaluateJson<boolean>(
    cdp,
    `(async () => {
      const started = performance.now();
      while (performance.now() - started < ${timeoutMs}) {
        if (window.__treesDevVirtualizationFixtureReady === true) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    })()`
  );

  if (!ready) {
    throw new Error(
      'Timed out waiting for the virtualization fixture to load.'
    );
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

async function waitForProfileSummary(
  cdp: CdpClient,
  timeoutMs: number
): Promise<PageRenderSummary> {
  const summary = await evaluateJson<{
    done: boolean;
    profile: PageRenderSummary | null;
  }>(
    cdp,
    `(async () => {
      const started = performance.now();
      while (performance.now() - started < ${timeoutMs}) {
        if (window.__treesDevVirtualizationProfile != null) {
          return { done: true, profile: window.__treesDevVirtualizationProfile };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return {
        done: false,
        profile: window.__treesDevVirtualizationProfile ?? null,
      };
    })()`
  );

  if (!summary.done || summary.profile == null) {
    throw new Error('Timed out waiting for the virtualization render summary.');
  }

  return summary.profile;
}

async function clickRenderButton(cdp: CdpClient): Promise<void> {
  const result = await evaluateJson<{
    ok: boolean;
    reason?: string;
    x?: number;
    y?: number;
  }>(
    cdp,
    `(() => {
      const button = document.querySelector('[data-profile-render-button]');
      if (!(button instanceof HTMLButtonElement)) {
        return { ok: false, reason: 'Missing [data-profile-render-button]' };
      }
      const rect = button.getBoundingClientRect();
      return {
        ok: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    })()`
  );

  if (!result.ok || result.x == null || result.y == null) {
    throw new Error(result.reason ?? 'Failed to click the render button.');
  }

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: result.x,
    y: result.y,
    button: 'none',
    pointerType: 'mouse',
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: result.x,
    y: result.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'mouse',
  });
  await Bun.sleep(16);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: result.x,
    y: result.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'mouse',
  });
}

async function collectProfilingArtifacts(
  cdp: CdpClient,
  timeoutMs: number,
  action: () => Promise<PageRenderSummary>
): Promise<{
  pageSummary: PageRenderSummary;
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

  let pageSummary: PageRenderSummary | null = null;
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
    throw actionError ?? new Error('Failed to collect the render summary.');
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

async function collectFunctionCallCounts(
  cdp: CdpClient,
  url: string,
  timeoutMs: number
): Promise<Map<string, number | null> | null> {
  try {
    await navigateToFixture(cdp, url, timeoutMs);
    await startPreciseCoverage(cdp);
    await clickRenderButton(cdp);
    await waitForProfileSummary(cdp, timeoutMs);
    const coverage = await stopPreciseCoverage(cdp);
    if (coverage == null) {
      return null;
    }
    return buildFunctionCallCountMap(coverage);
  } catch {
    await cdp.send('Profiler.stopPreciseCoverage').catch(() => {});
    await cdp.send('Profiler.disable').catch(() => {});
    return null;
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

async function profileVirtualizedRender(
  config: ProfileConfig,
  workloadName: string,
  runNumber: number,
  traceOutputPath: string | null
): Promise<ProfileResult> {
  const profileUrl = createProfileUrl(
    config.url,
    config.instrumentationMode,
    workloadName
  );
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
    await navigateToFixture(cdp, profileUrl, config.timeoutMs);

    const { pageSummary, trace, cpuProfile } = await collectProfilingArtifacts(
      cdp,
      config.timeoutMs,
      async () => {
        await clickRenderButton(cdp);
        return await waitForProfileSummary(cdp, config.timeoutMs);
      }
    );
    const callCountsByFunction = config.includeCallCounts
      ? await collectFunctionCallCounts(cdp, profileUrl, config.timeoutMs)
      : null;

    return {
      runNumber,
      browserUrl: config.browserUrl,
      url: profileUrl,
      workload: getPageWorkloadSummary(pageSummary, profileUrl),
      traceOutputPath: writeTraceIfAvailable(trace, traceOutputPath),
      renderedItemCount: pageSummary.renderedItemCount,
      visibleRowsReadyMs:
        pageSummary.visibleRowsReadyMs == null
          ? null
          : Number(pageSummary.visibleRowsReadyMs.toFixed(3)),
      renderDurationMs: Number(pageSummary.renderDurationMs.toFixed(3)),
      longTaskCount: pageSummary.longTaskCount ?? null,
      longTaskTotalMs:
        pageSummary.longTaskTotalMs == null
          ? null
          : Number(pageSummary.longTaskTotalMs.toFixed(3)),
      longestLongTaskMs:
        pageSummary.longestLongTaskMs == null
          ? null
          : Number(pageSummary.longestLongTaskMs.toFixed(3)),
      instrumentation: summarizeInstrumentation(pageSummary),
      trace: summarizeTrace(trace, pageSummary),
      cpuProfile: summarizeCpuProfile(cpuProfile, callCountsByFunction),
    };
  } finally {
    cdp.close();
    await closePageTarget(config.browserUrl, target.id, config.timeoutMs);
  }
}

function printRunHumanSummary(
  result: ProfileResult,
  totalRuns: number,
  showDominantTraceEvents: boolean
): void {
  const summaryRows = [['Visible rows', String(result.renderedItemCount)]];

  if (result.visibleRowsReadyMs != null) {
    summaryRows.push([
      'Visible rows ready',
      formatMs(result.visibleRowsReadyMs),
    ]);
  }
  summaryRows.push(['Post-paint ready', formatMs(result.renderDurationMs)]);

  if (result.trace.available) {
    if (result.trace.clickDispatchMs != null) {
      summaryRows.push([
        'Click dispatch task',
        formatMs(result.trace.clickDispatchMs),
      ]);
    }
    if (result.trace.clickToRenderReadyMs != null) {
      summaryRows.push([
        'Click-to-post-paint-ready',
        formatMs(result.trace.clickToRenderReadyMs),
      ]);
    }
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
      String(result.trace.topLevelTaskCount ?? 'n/a'),
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
      maxWidths: [28, 18],
    })
  );

  const phaseRows = createNestedPhaseRows(result.instrumentation.phases);
  if (phaseRows.length > 0) {
    console.log('');
    console.log('Phases');
    console.log('Total includes nested child phases. Own excludes them.');
    console.log(
      createTable(
        ['Phase', 'Total', 'Own', 'Own %', 'Calls', 'Workload'],
        phaseRows.map(({ label, phase }) => [
          label,
          formatMs(phase.durationMs),
          formatMs(phase.selfDurationMs),
          formatPercent(phase.selfPercentOfRender),
          formatCount(phase.count),
          phase.workload ?? 'n/a',
        ]),
        {
          alignments: ['left', 'right', 'right', 'right', 'right', 'left'],
          maxWidths: [32, 12, 12, 9, 8, 38],
        }
      )
    );
  }

  if (result.instrumentation.heap.available) {
    console.log('');
    console.log('Heap');
    console.log(
      createTable(
        ['Metric', 'Value'],
        [
          [
            'Used JS heap before',
            formatBytes(result.instrumentation.heap.usedJSHeapSizeBeforeBytes),
          ],
          [
            'Used JS heap after',
            formatBytes(result.instrumentation.heap.usedJSHeapSizeAfterBytes),
          ],
          [
            'Used JS heap delta',
            formatBytes(result.instrumentation.heap.usedJSHeapSizeDeltaBytes),
          ],
          [
            'Total JS heap after',
            formatBytes(result.instrumentation.heap.totalJSHeapSizeAfterBytes),
          ],
          [
            'JS heap limit',
            formatBytes(result.instrumentation.heap.jsHeapSizeLimitBytes),
          ],
        ],
        {
          alignments: ['left', 'right'],
          maxWidths: [24, 18],
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
    const hasCallCounts = result.cpuProfile.bottomUpFunctions.some(
      (functionSummary) => functionSummary.callCount != null
    );
    console.log('');
    console.log('CPU Summary');
    console.log(
      createTable(
        ['Metric', 'Value'],
        [
          ['Sampled CPU time', formatMs(result.cpuProfile.sampledMs)],
          ['Samples', String(result.cpuProfile.sampleCount ?? 'n/a')],
          ...(hasCallCounts ? [['Call counts', 'auxiliary pass']] : []),
        ],
        {
          alignments: ['left', 'right'],
          maxWidths: [24, 18],
        }
      )
    );

    if (result.cpuProfile.bottomUpFunctions.length > 0) {
      console.log('');
      console.log('Bottom-Up CPU');
      console.log(
        createTable(
          hasCallCounts
            ? ['Function', 'Calls', 'Self', 'Self %', 'Total', 'Total %']
            : ['Function', 'Self', 'Self %', 'Total', 'Total %'],
          result.cpuProfile.bottomUpFunctions.map((functionSummary) => {
            const baseRow = [
              functionSummary.name,
              formatMs(functionSummary.selfMs),
              formatPercent(functionSummary.selfPercent),
              formatMs(functionSummary.totalMs),
              formatPercent(functionSummary.totalPercent),
            ];
            return hasCallCounts
              ? [
                  functionSummary.name,
                  functionSummary.callCount == null
                    ? 'n/a'
                    : String(functionSummary.callCount),
                  ...baseRow.slice(1),
                ]
              : baseRow;
          }),
          {
            alignments: hasCallCounts
              ? ['left', 'right', 'right', 'right', 'right', 'right']
              : ['left', 'right', 'right', 'right', 'right'],
            maxWidths: hasCallCounts
              ? [68, 10, 12, 9, 12, 9]
              : [78, 12, 9, 12, 9],
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

function createJsonAggregateSummary(
  results: ProfileResult[]
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

function formatSignedNumber(
  value: number | null,
  digits: number,
  suffix: string
): string {
  if (value == null || !Number.isFinite(value)) {
    return 'n/a';
  }

  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(digits)}${suffix}`;
}

function formatDeltaMsPct(
  deltaMs: number | null,
  deltaPct: number | null
): string {
  if (
    (deltaMs == null || !Number.isFinite(deltaMs)) &&
    (deltaPct == null || !Number.isFinite(deltaPct))
  ) {
    return 'n/a';
  }

  if (deltaMs == null || !Number.isFinite(deltaMs)) {
    return formatSignedNumber(deltaPct, 1, '%');
  }

  if (deltaPct == null || !Number.isFinite(deltaPct)) {
    return formatSignedNumber(deltaMs, 2, ' ms');
  }

  return `${formatSignedNumber(deltaMs, 2, ' ms')} (${formatSignedNumber(
    deltaPct,
    1,
    '%'
  )})`;
}

function createMetricDelta(
  baseline: number | null,
  current: number | null
): {
  baseline: number | null;
  current: number | null;
  deltaMs: number | null;
  deltaPct: number | null;
} {
  const deltaMs =
    baseline == null || current == null
      ? null
      : Number((current - baseline).toFixed(3));
  const deltaPct =
    baseline == null ||
    current == null ||
    !Number.isFinite(baseline) ||
    baseline === 0
      ? null
      : Number((((current - baseline) / baseline) * 100).toFixed(1));

  return {
    baseline,
    current,
    deltaMs,
    deltaPct,
  };
}

function createMetricComparisonSummary(
  baseline: AggregateMetricSummary,
  current: AggregateMetricSummary
): MetricComparisonSummary {
  return {
    label: current.label,
    availableRuns: {
      baseline: baseline.availableRuns,
      current: current.availableRuns,
    },
    averageMs: createMetricDelta(baseline.averageMs, current.averageMs),
    medianMs: createMetricDelta(baseline.medianMs, current.medianMs),
    p95Ms: createMetricDelta(baseline.p95Ms, current.p95Ms),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function normalizeComparableUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.delete('instrumentation');
    parsedUrl.searchParams.delete('workload');
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

function inferInstrumentationModeFromUrl(url: string): 'on' | 'off' {
  try {
    return new URL(url).searchParams.get('instrumentation') === '0'
      ? 'off'
      : 'on';
  } catch {
    return 'on';
  }
}

/** Reads older single-workload JSON so compare mode keeps working across script revisions. */
function createLegacyConfigSummaryFromRuns(
  runs: ProfileResult[]
): ProfileConfigSummary {
  const firstRun = runs[0];
  const workloadNames = [...new Set(runs.map((run) => run.workload.name))];
  const includeCallCounts = runs.some((run) => {
    return run.cpuProfile.bottomUpFunctions.some((fn) => fn.callCount != null);
  });

  return {
    browserUrl: firstRun?.browserUrl ?? DEFAULT_BROWSER_URL,
    url: normalizeComparableUrl(firstRun?.url ?? DEFAULT_URL),
    workloads:
      workloadNames.length > 0 ? workloadNames : [DEFAULT_WORKLOAD_NAME],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    runs: runs.length,
    warmupRuns: 0,
    instrumentationMode: inferInstrumentationModeFromUrl(firstRun?.url ?? ''),
    includeCallCounts,
    showDominantTraceEvents: false,
  };
}

function normalizeProfileBenchmarkOutput(
  rawValue: unknown,
  sourcePath: string
): ProfileBenchmarkOutput {
  if (!isRecord(rawValue)) {
    throw new Error(`Invalid benchmark JSON in ${sourcePath}.`);
  }

  if (
    rawValue.benchmark != null &&
    rawValue.benchmark !== 'virtualizationProfile'
  ) {
    const benchmarkDescription =
      typeof rawValue.benchmark === 'string'
        ? rawValue.benchmark
        : JSON.stringify(rawValue.benchmark);
    throw new Error(
      `Unsupported benchmark type in ${sourcePath}: ${benchmarkDescription ?? 'unknown'}`
    );
  }

  if (Array.isArray(rawValue.workloads)) {
    const workloads = (rawValue.workloads as ProfileWorkloadOutput[]).map(
      (workloadOutput) => {
        return {
          workload: workloadOutput.workload,
          runs: workloadOutput.runs,
          summary: createJsonAggregateSummary(workloadOutput.runs),
        };
      }
    );
    if (workloads.length === 0) {
      throw new Error(`No workload results found in ${sourcePath}.`);
    }

    const fallbackConfig = createLegacyConfigSummaryFromRuns(
      workloads.flatMap((workloadOutput) => workloadOutput.runs)
    );
    const rawConfig = isRecord(rawValue.config)
      ? (rawValue.config as Partial<ProfileConfigSummary>)
      : {};

    return {
      benchmark: 'virtualizationProfile',
      config: {
        ...fallbackConfig,
        ...rawConfig,
        url: normalizeComparableUrl(rawConfig.url ?? fallbackConfig.url),
        workloads: workloads.map(
          (workloadOutput) => workloadOutput.workload.name
        ),
        runs: rawConfig.runs ?? workloads[0].runs.length,
        warmupRuns: rawConfig.warmupRuns ?? fallbackConfig.warmupRuns,
        instrumentationMode:
          rawConfig.instrumentationMode ?? fallbackConfig.instrumentationMode,
        includeCallCounts:
          rawConfig.includeCallCounts ?? fallbackConfig.includeCallCounts,
        showDominantTraceEvents:
          rawConfig.showDominantTraceEvents ??
          fallbackConfig.showDominantTraceEvents,
      },
      workloads,
    };
  }

  if (Array.isArray(rawValue.runs)) {
    const runs = rawValue.runs as ProfileResult[];
    if (runs.length === 0) {
      throw new Error(`No benchmark runs found in ${sourcePath}.`);
    }

    const workloadOutput = createWorkloadOutput(runs);
    return {
      benchmark: 'virtualizationProfile',
      config: createLegacyConfigSummaryFromRuns(runs),
      workloads: [workloadOutput],
    };
  }

  throw new Error(
    `Expected ${sourcePath} to contain either { workloads: [...] } or { runs: [...] }.`
  );
}

function readProfileBenchmarkOutput(
  benchmarkPath: string
): ProfileBenchmarkOutput {
  const rawText = readFileSync(benchmarkPath, 'utf8');
  const rawValue = JSON.parse(rawText) as unknown;
  return normalizeProfileBenchmarkOutput(rawValue, benchmarkPath);
}

function assertComparableBenchmarkOutputs(
  baseline: ProfileBenchmarkOutput,
  current: ProfileBenchmarkOutput
): void {
  if (
    normalizeComparableUrl(baseline.config.url) !==
    normalizeComparableUrl(current.config.url)
  ) {
    throw new Error(
      [
        'Cannot compare benchmark outputs with different URLs.',
        `Baseline: ${baseline.config.url}`,
        `Current: ${current.config.url}`,
      ].join('\n')
    );
  }

  if (
    baseline.config.instrumentationMode !== current.config.instrumentationMode
  ) {
    throw new Error(
      [
        'Cannot compare benchmark outputs with different instrumentation modes.',
        `Baseline: ${baseline.config.instrumentationMode}`,
        `Current: ${current.config.instrumentationMode}`,
      ].join('\n')
    );
  }
}

function createProfileComparisonSummary(
  baselinePath: string,
  baseline: ProfileBenchmarkOutput,
  current: ProfileBenchmarkOutput
): ProfileComparisonSummary {
  assertComparableBenchmarkOutputs(baseline, current);

  const baselineByWorkloadName = new Map(
    baseline.workloads.map((workloadOutput) => [
      workloadOutput.workload.name,
      workloadOutput,
    ])
  );
  const currentByWorkloadName = new Map(
    current.workloads.map((workloadOutput) => [
      workloadOutput.workload.name,
      workloadOutput,
    ])
  );

  const workloads: WorkloadComparisonSummary[] = [];
  for (const currentWorkloadOutput of current.workloads) {
    const baselineWorkloadOutput = baselineByWorkloadName.get(
      currentWorkloadOutput.workload.name
    );
    if (baselineWorkloadOutput == null) {
      continue;
    }

    const metrics = Object.fromEntries(
      AGGREGATE_METRIC_DEFINITIONS.map((definition) => [
        definition.key,
        createMetricComparisonSummary(
          baselineWorkloadOutput.summary.metrics[definition.key],
          currentWorkloadOutput.summary.metrics[definition.key]
        ),
      ])
    ) as Record<AggregateMetricKey, MetricComparisonSummary>;

    workloads.push({
      workload: currentWorkloadOutput.workload,
      baselineWorkload: baselineWorkloadOutput.workload,
      workloadShapeMatches:
        baselineWorkloadOutput.workload.fileCount ===
          currentWorkloadOutput.workload.fileCount &&
        baselineWorkloadOutput.workload.expandedFolderCount ===
          currentWorkloadOutput.workload.expandedFolderCount,
      metrics,
    });
  }

  return {
    baselinePath,
    unmatchedBaselineWorkloads: baseline.workloads
      .map((workloadOutput) => workloadOutput.workload.name)
      .filter((workloadName) => !currentByWorkloadName.has(workloadName)),
    unmatchedCurrentWorkloads: current.workloads
      .map((workloadOutput) => workloadOutput.workload.name)
      .filter((workloadName) => !baselineByWorkloadName.has(workloadName)),
    workloads,
  };
}

function printWorkloadHumanSummary(
  workloadOutput: ProfileWorkloadOutput,
  config: ProfileConfigSummary
): void {
  const workloadRows = [
    [
      'Workload',
      `${workloadOutput.workload.label} (${workloadOutput.workload.name})`,
    ],
    ['Files', formatCount(workloadOutput.workload.fileCount)],
    [
      'Expanded folders',
      formatCount(workloadOutput.workload.expandedFolderCount),
    ],
    ['Measured runs', String(workloadOutput.runs.length)],
    ['Warmup runs', String(config.warmupRuns)],
  ];

  console.log('Workload');
  console.log(
    createTable(['Field', 'Value'], workloadRows, {
      maxWidths: [18, 96],
    })
  );

  for (const [index, result] of workloadOutput.runs.entries()) {
    console.log('');
    printRunHumanSummary(
      result,
      workloadOutput.runs.length,
      config.showDominantTraceEvents
    );
    if (index < workloadOutput.runs.length - 1) {
      console.log('');
    }
  }

  if (workloadOutput.runs.length > 1) {
    console.log('');
    printAggregateHumanSummary(
      workloadOutput.summary,
      workloadOutput.runs.length
    );
  }
}

function printComparisonHumanSummary(
  comparison: ProfileComparisonSummary
): void {
  console.log('Comparison');
  console.log(
    createTable(
      ['Field', 'Value'],
      [
        ['Baseline JSON', comparison.baselinePath],
        ['Matched workloads', String(comparison.workloads.length)],
        [
          'Baseline-only workloads',
          comparison.unmatchedBaselineWorkloads.length === 0
            ? 'none'
            : comparison.unmatchedBaselineWorkloads.join(', '),
        ],
        [
          'Current-only workloads',
          comparison.unmatchedCurrentWorkloads.length === 0
            ? 'none'
            : comparison.unmatchedCurrentWorkloads.join(', '),
        ],
      ],
      {
        maxWidths: [22, 96],
      }
    )
  );

  for (const workloadComparison of comparison.workloads) {
    console.log('');
    console.log(
      `Workload: ${workloadComparison.workload.label} (${workloadComparison.workload.name})`
    );

    if (!workloadComparison.workloadShapeMatches) {
      console.log(
        createTable(
          ['Shape', 'Files', 'Expanded folders'],
          [
            [
              'Baseline',
              formatCount(workloadComparison.baselineWorkload.fileCount),
              formatCount(
                workloadComparison.baselineWorkload.expandedFolderCount
              ),
            ],
            [
              'Current',
              formatCount(workloadComparison.workload.fileCount),
              formatCount(workloadComparison.workload.expandedFolderCount),
            ],
          ],
          {
            alignments: ['left', 'right', 'right'],
            maxWidths: [12, 16, 18],
          }
        )
      );
      console.log('');
    }

    console.log(
      createTable(
        [
          'Metric',
          'Baseline median',
          'Current median',
          'Median delta',
          'Baseline P95',
          'Current P95',
          'P95 delta',
        ],
        AGGREGATE_METRIC_DEFINITIONS.map((definition) => {
          const metric = workloadComparison.metrics[definition.key];
          return [
            metric.label,
            formatMs(metric.medianMs.baseline),
            formatMs(metric.medianMs.current),
            formatDeltaMsPct(metric.medianMs.deltaMs, metric.medianMs.deltaPct),
            formatMs(metric.p95Ms.baseline),
            formatMs(metric.p95Ms.current),
            formatDeltaMsPct(metric.p95Ms.deltaMs, metric.p95Ms.deltaPct),
          ];
        }),
        {
          alignments: [
            'left',
            'right',
            'right',
            'right',
            'right',
            'right',
            'right',
          ],
          maxWidths: [28, 16, 16, 22, 16, 16, 22],
        }
      )
    );
  }
}

function printRunsHumanSummary(output: ProfileBenchmarkOutput): void {
  if (output.workloads.length === 0) {
    return;
  }

  const runInfoRows = [
    ['Browser', output.config.browserUrl],
    ['URL', output.config.url],
    ['Workloads', output.config.workloads.join(', ')],
    ['Measured runs/workload', String(output.config.runs)],
    ['Warmup runs/workload', String(output.config.warmupRuns)],
    ['Instrumentation', output.config.instrumentationMode],
    ['Call counts', output.config.includeCallCounts ? 'on' : 'off'],
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

  for (const [index, workloadOutput] of output.workloads.entries()) {
    console.log('');
    printWorkloadHumanSummary(workloadOutput, output.config);
    if (index < output.workloads.length - 1) {
      console.log('');
    }
  }

  if (output.comparison != null) {
    console.log('');
    printComparisonHumanSummary(output.comparison);
  }
}

async function runWorkloadProfile(
  config: ProfileConfig,
  workloadName: string
): Promise<ProfileWorkloadOutput> {
  const results: ProfileResult[] = [];

  for (
    let warmupRunNumber = 1;
    warmupRunNumber <= config.warmupRuns;
    warmupRunNumber += 1
  ) {
    await profileVirtualizedRender(
      {
        ...config,
        includeCallCounts: false,
      },
      workloadName,
      warmupRunNumber,
      null
    );
  }

  for (let runNumber = 1; runNumber <= config.runs; runNumber += 1) {
    const traceOutputPath = createRunTraceOutputPath(
      config.traceOutputPath,
      workloadName,
      config.workloads.length,
      runNumber,
      config.runs
    );
    const result = await profileVirtualizedRender(
      config,
      workloadName,
      runNumber,
      traceOutputPath
    );
    results.push(result);
  }

  return createWorkloadOutput(results);
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  let serverProcess: Bun.Subprocess | null = null;

  try {
    serverProcess = await startFixtureServerIfNeeded(config);

    const workloads: ProfileWorkloadOutput[] = [];
    for (const workloadName of config.workloads) {
      workloads.push(await runWorkloadProfile(config, workloadName));
    }

    const output: ProfileBenchmarkOutput = {
      benchmark: 'virtualizationProfile',
      config: createProfileConfigSummary(config),
      workloads,
    };

    if (config.comparePath != null) {
      const baselineOutput = readProfileBenchmarkOutput(config.comparePath);
      output.comparison = createProfileComparisonSummary(
        config.comparePath,
        baselineOutput,
        output
      );
    }

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
