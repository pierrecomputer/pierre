import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorktreeEnv } from '../../../scripts/load-worktree-env.mjs';

interface ProfileConfig {
  browserUrl: string;
  url: string;
  timeoutMs: number;
  runs: number;
  warmupRuns: number;
  outputJson: boolean;
  showDominantTraceEvents: boolean;
  traceOutputPath: string;
  ensureServer: boolean;
}

interface TraceEvent {
  name: string;
  ph: string;
  cat?: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
  args?: {
    data?: {
      message?: string;
      name?: string;
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

interface PageProfileSummary {
  action: {
    id: string;
    label: string;
  };
  detail: string;
  diffContainerCount: number;
  fileCount: number;
  hunkCount: number;
  lineCount: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestLongTaskMs: number;
  renderCallMs: number;
  postPaintReadyMs: number;
  wrapperChildCount: number;
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
  | 'renderCallMs'
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

interface ProfileBenchmarkOutput {
  benchmark: 'diffsDemoProfile';
  config: {
    browserUrl: string;
    url: string;
    timeoutMs: number;
    runs: number;
    warmupRuns: number;
    showDominantTraceEvents: boolean;
  };
  scenario: {
    action: PageProfileSummary['action'];
    fileCount: number;
    hunkCount: number;
    lineCount: number;
  };
  runs: ProfileRunResult[];
  summary: JsonAggregateSummary;
}

loadWorktreeEnv();

function readWorktreePortOffset(): number {
  const parsed = Number(process.env.PIERRE_PORT_OFFSET ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const WORKTREE_PORT_OFFSET = readWorktreePortOffset();
const DEFAULT_BROWSER_DEBUG_PORT = 9222 + WORKTREE_PORT_OFFSET;
const DEFAULT_DEMO_SERVER_PORT = 5173 + WORKTREE_PORT_OFFSET;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const demoRoot = fileURLToPath(new URL('../../../apps/demo/', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const DEFAULT_BROWSER_URL = `http://127.0.0.1:${DEFAULT_BROWSER_DEBUG_PORT}`;
const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_DEMO_SERVER_PORT}/`;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RUN_COUNT = 1;
const DEFAULT_WARMUP_RUN_COUNT = 0;
const DEFAULT_TRACE_OUTPUT_DIR = resolve(tmpdir(), 'pierrejs-diffs-traces');
const DEFAULT_TRACE_OUTPUT_EXAMPLE_PATH = resolve(
  DEFAULT_TRACE_OUTPUT_DIR,
  'diffs-demo-profile-trace-<run-id>.json'
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
const FIXTURE_READY_EXPRESSION = `window.__diffsDemoFixtureReady === true && window.diffsDemoProfile != null`;
const PROFILE_START_LABEL = 'diffs-demo-profile-start';
const PROFILE_END_LABEL = 'diffs-demo-profile-end';
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
    key: 'renderCallMs',
    label: 'Render call',
    select: (result) => result.page.renderCallMs,
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
  console.log('Usage: bun ws diffs profile -- [options]');
  console.log('');
  console.log(
    'Profiles the apps/demo "Load Large-ish Diff" fixture through Chrome remote debugging.'
  );
  console.log(
    'If the local debug port is closed, the profiler starts `bun run chrome` automatically.'
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
    `  --timeout <ms>           Navigation/action timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`
  );
  console.log(
    `  --runs <count>           Number of measured runs (default: ${DEFAULT_RUN_COUNT})`
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
    '  --no-server              Do not auto-start the demo Vite server'
  );
  console.log('  --json                   Emit machine-readable JSON output');
  console.log('  -h, --help               Show this help output');
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

function createTraceRunId(): string {
  return randomUUID().slice(0, 8);
}

function createDefaultTraceOutputPath(): string {
  return resolve(
    DEFAULT_TRACE_OUTPUT_DIR,
    `diffs-demo-profile-trace-${createTraceRunId()}.json`
  );
}

function createRunTraceOutputPath(
  traceOutputPath: string,
  runNumber: number,
  totalRuns: number
): string {
  if (totalRuns === 1) {
    return traceOutputPath;
  }

  const extensionIndex = traceOutputPath.lastIndexOf('.');
  const runSuffix = `-run-${String(runNumber).padStart(String(totalRuns).length, '0')}`;
  if (extensionIndex <= 0) {
    return `${traceOutputPath}${runSuffix}`;
  }
  return `${traceOutputPath.slice(0, extensionIndex)}${runSuffix}${traceOutputPath.slice(extensionIndex)}`;
}

function parseArgs(argv: string[]): ProfileConfig {
  const config: ProfileConfig = {
    browserUrl: DEFAULT_BROWSER_URL,
    url: DEFAULT_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    runs: DEFAULT_RUN_COUNT,
    warmupRuns: DEFAULT_WARMUP_RUN_COUNT,
    outputJson: false,
    showDominantTraceEvents: false,
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
    if (rawArg === '--no-server') {
      config.ensureServer = false;
      continue;
    }

    const [flag, inlineValue] = rawArg.split('=', 2);
    if (
      flag === '--browser-url' ||
      flag === '--url' ||
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
  try {
    const response = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
    response.body?.cancel().catch(() => {});
    return response.ok;
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

function createBrowserVersionUrl(browserUrl: string): string {
  return `${browserUrl.replace(/\/$/, '')}/json/version`;
}

function decodeOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}

async function isChromeDebugEndpointAvailable(
  browserUrl: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    const version = await fetchJson<Partial<InspectVersionResponse>>(
      createBrowserVersionUrl(browserUrl),
      undefined,
      timeoutMs
    );
    return (
      typeof version.webSocketDebuggerUrl === 'string' &&
      version.webSocketDebuggerUrl !== ''
    );
  } catch {
    return false;
  }
}

function readLocalBrowserDebugPort(browserUrl: string): number | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(browserUrl);
  } catch {
    return null;
  }

  const localHosts = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
  if (
    parsedUrl.protocol !== 'http:' ||
    !localHosts.has(parsedUrl.hostname) ||
    parsedUrl.port === ''
  ) {
    return null;
  }

  const port = Number.parseInt(parsedUrl.port, 10);
  return Number.isInteger(port) && port > 0 ? port : null;
}

function launchChromeDebugPort(browserUrl: string): void {
  const browserDebugPort = readLocalBrowserDebugPort(browserUrl);
  if (browserDebugPort == null) {
    throw new Error(
      `Chrome debug endpoint ${createBrowserVersionUrl(
        browserUrl
      )} is not reachable. Automatic launch is only supported for localhost browser URLs with an explicit port.`
    );
  }

  const launchResult = Bun.spawnSync({
    cmd: ['bun', 'run', 'chrome'],
    cwd: repoRoot,
    env: {
      ...process.env,
      AGENT: '1',
      PIERRE_PORT_OFFSET: String(browserDebugPort - 9222),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (launchResult.exitCode !== 0) {
    const stdout = decodeOutput(launchResult.stdout);
    const stderr = decodeOutput(launchResult.stderr);
    throw new Error(
      [
        `Failed to launch Chrome debug port ${browserDebugPort}.`,
        stdout !== '' ? `stdout:\n${stdout}` : null,
        stderr !== '' ? `stderr:\n${stderr}` : null,
      ]
        .filter((value): value is string => value != null)
        .join('\n\n')
    );
  }
}

async function ensureChromeDebugPort(config: ProfileConfig): Promise<void> {
  if (await isChromeDebugEndpointAvailable(config.browserUrl, 1_000)) {
    return;
  }

  launchChromeDebugPort(config.browserUrl);
  if (
    await isChromeDebugEndpointAvailable(config.browserUrl, config.timeoutMs)
  ) {
    return;
  }

  throw new Error(
    `Chrome debug endpoint ${createBrowserVersionUrl(
      config.browserUrl
    )} is still not reachable after launching Chrome.`
  );
}

function getPortFromUrl(url: string): string {
  const parsedUrl = new URL(url);
  if (parsedUrl.port !== '') {
    return parsedUrl.port;
  }
  return parsedUrl.protocol === 'https:' ? '443' : '80';
}

/** Starts the demo fixture only when the target URL is not already available. */
async function startDemoServerIfNeeded(
  config: ProfileConfig
): Promise<Bun.Subprocess | null> {
  if (!config.ensureServer) {
    return null;
  }

  if (await isUrlReachable(config.url, 1_000)) {
    return null;
  }

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
    throw new Error(
      `Failed to build @pierre/diffs before starting the demo:\n${new TextDecoder().decode(buildResult.stderr)}`
    );
  }

  const serverProcess = Bun.spawn({
    cmd: ['bun', 'run', 'dev:vite'],
    cwd: demoRoot,
    env: {
      ...process.env,
      AGENT: '1',
      DEMO_PORT: getPortFromUrl(config.url),
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

    await new Promise<void>((resolvePromise, reject) => {
      const timeout = createManagedTimeout(timeoutMs, () => {
        reject(new Error(`Timed out connecting to ${url}`));
      });

      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timeout);
          resolvePromise();
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

    const resultPromise = new Promise<TResult>((resolvePromise, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolvePromise(value as TResult),
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
    return new Promise<TParams>((resolvePromise, reject) => {
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
        resolvePromise(params);
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
    throw new Error('Timed out waiting for the diffs demo to load.');
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

function findTraceWindow(
  events: TraceEvent[],
  pageSummary: PageProfileSummary
): TraceWindow | null {
  const startEvent = findMarkerEvent(events, PROFILE_START_LABEL);
  const endEvent = findMarkerEvent(events, PROFILE_END_LABEL);
  if (
    startEvent != null &&
    endEvent != null &&
    typeof startEvent.ts === 'number' &&
    typeof endEvent.ts === 'number' &&
    endEvent.ts >= startEvent.ts
  ) {
    return {
      startTs: startEvent.ts,
      endTs: endEvent.ts,
      pid: startEvent.pid,
      tid: startEvent.tid,
      source: 'profile-markers',
    };
  }

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
  return await new Promise<TValue>((resolvePromise, reject) => {
    const timeout = createManagedTimeout(timeoutMs, () => {
      reject(new Error(message));
    });

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolvePromise(value);
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
  timeoutMs: number
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
    pageSummary = await evaluateJson<PageProfileSummary>(
      cdp,
      `window.diffsDemoProfile.profileLargeDiffRender()`
    );
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

async function profileDemoRun(
  config: ProfileConfig,
  runNumber: number,
  traceOutputPath: string | null
): Promise<ProfileRunResult> {
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
    config.url,
    config.timeoutMs
  );
  const cdp = await CdpClient.connect(
    target.webSocketDebuggerUrl,
    config.timeoutMs
  );

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await navigateToDemo(cdp, config.url, config.timeoutMs);
    await evaluateJson(
      cdp,
      `window.diffsDemoProfile.prepareLargeDiffProfile()`
    );

    const { pageSummary, trace, cpuProfile } = await collectProfilingArtifacts(
      cdp,
      config.timeoutMs
    );

    return {
      runNumber,
      browserUrl: config.browserUrl,
      url: config.url,
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

function printRunHumanSummary(
  result: ProfileRunResult,
  totalRuns: number,
  showDominantTraceEvents: boolean
): void {
  const summaryRows = [
    ['Render call', formatMs(result.page.renderCallMs)],
    ['Post-paint ready', formatMs(result.page.postPaintReadyMs)],
    ['Files', formatCount(result.page.fileCount)],
    ['Hunks', formatCount(result.page.hunkCount)],
    ['Diff lines', formatCount(result.page.lineCount)],
    ['Diff containers', formatCount(result.page.diffContainerCount)],
    ['Wrapper children', formatCount(result.page.wrapperChildCount)],
  ];

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

function printRunsHumanSummary(output: ProfileBenchmarkOutput): void {
  const runInfoRows = [
    ['Browser', output.config.browserUrl],
    ['URL', output.config.url],
    [
      'Action',
      `${output.scenario.action.label} (${output.scenario.action.id})`,
    ],
    ['Measured runs', String(output.config.runs)],
    ['Warmup runs', String(output.config.warmupRuns)],
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

  console.log('');
  console.log('Scenario');
  console.log(
    createTable(
      ['Field', 'Value'],
      [
        ['Fixture', 'apps/demo root page'],
        [
          'Action',
          `${output.scenario.action.label} (${output.scenario.action.id})`,
        ],
        ['Files', formatCount(output.scenario.fileCount)],
        ['Hunks', formatCount(output.scenario.hunkCount)],
        ['Diff lines', formatCount(output.scenario.lineCount)],
      ],
      {
        maxWidths: [18, 96],
      }
    )
  );

  for (const [index, result] of output.runs.entries()) {
    console.log('');
    printRunHumanSummary(
      result,
      output.runs.length,
      output.config.showDominantTraceEvents
    );
    if (index < output.runs.length - 1) {
      console.log('');
    }
  }

  if (output.runs.length > 1) {
    console.log('');
    printAggregateHumanSummary(output.summary, output.runs.length);
  }
}

async function runProfile(config: ProfileConfig): Promise<ProfileRunResult[]> {
  const results: ProfileRunResult[] = [];

  for (
    let warmupRunNumber = 1;
    warmupRunNumber <= config.warmupRuns;
    warmupRunNumber += 1
  ) {
    await profileDemoRun(config, warmupRunNumber, null);
  }

  for (let runNumber = 1; runNumber <= config.runs; runNumber += 1) {
    const traceOutputPath = createRunTraceOutputPath(
      config.traceOutputPath,
      runNumber,
      config.runs
    );
    const result = await profileDemoRun(config, runNumber, traceOutputPath);
    results.push(result);
  }

  return results;
}

function createBenchmarkOutput(
  config: ProfileConfig,
  runs: ProfileRunResult[]
): ProfileBenchmarkOutput {
  if (runs.length === 0) {
    throw new Error('Cannot summarize an empty profile run.');
  }

  const firstRun = runs[0];
  return {
    benchmark: 'diffsDemoProfile',
    config: {
      browserUrl: config.browserUrl,
      url: config.url,
      timeoutMs: config.timeoutMs,
      runs: config.runs,
      warmupRuns: config.warmupRuns,
      showDominantTraceEvents: config.showDominantTraceEvents,
    },
    scenario: {
      action: firstRun.page.action,
      fileCount: firstRun.page.fileCount,
      hunkCount: firstRun.page.hunkCount,
      lineCount: firstRun.page.lineCount,
    },
    runs,
    summary: createJsonAggregateSummary(runs),
  };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  let serverProcess: Bun.Subprocess | null = null;

  try {
    await ensureChromeDebugPort(config);
    serverProcess = await startDemoServerIfNeeded(config);
    const runs = await runProfile(config);
    const output = createBenchmarkOutput(config, runs);

    if (config.outputJson) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printRunsHumanSummary(output);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}\n\nThe profiler checks ${createBrowserVersionUrl(
        config.browserUrl
      )} before profiling and starts \`bun run chrome\` automatically when a local debug port is closed.`
    );
  } finally {
    serverProcess?.kill();
  }
}

await main();
