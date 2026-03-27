import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ProfileConfig {
  browserUrl: string;
  url: string;
  timeoutMs: number;
  runs: number;
  includeCallCounts: boolean;
  outputJson: boolean;
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

interface PageRenderSummary {
  renderedItemCount: number;
  renderDurationMs: number;
  longTaskCount?: number;
  longTaskTotalMs?: number;
  longestLongTaskMs?: number;
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
  scriptingMs: number | null;
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

interface ProfileResult {
  runNumber: number;
  browserUrl: string;
  url: string;
  traceOutputPath: string | null;
  renderedItemCount: number;
  renderDurationMs: number;
  longTaskCount: number | null;
  longTaskTotalMs: number | null;
  longestLongTaskMs: number | null;
  trace: TraceSummary;
  cpuProfile: CpuProfileSummary;
}

interface AggregateMetricSummary {
  label: string;
  availableRuns: number;
  totalMs: number | null;
  averageMs: number | null;
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
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RUN_COUNT = 1;
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
    `  --timeout <ms>         Navigation/render timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`
  );
  console.log(
    `  --runs <count>         Number of benchmark runs to execute (default: ${DEFAULT_RUN_COUNT})`
  );
  console.log(
    '  --call-counts         Run a second precise-coverage pass to annotate bottom-up functions with invocation counts'
  );
  console.log(
    `  --trace-out <path>     Where to save the Chrome trace JSON when tracing succeeds (default: ${DEFAULT_TRACE_OUTPUT_EXAMPLE_PATH})`
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
  runNumber: number,
  totalRuns: number
): string {
  if (totalRuns <= 1) {
    return traceOutputPath;
  }

  const runSuffix = `-run-${String(runNumber).padStart(
    String(totalRuns).length,
    '0'
  )}`;
  const extensionIndex = traceOutputPath.lastIndexOf('.');
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
    includeCallCounts: false,
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
      flag === '--timeout' ||
      flag === '--runs' ||
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
    };
  }

  const totalMs = values.reduce((total, value) => total + value, 0);
  return {
    label,
    availableRuns: values.length,
    totalMs: Number(totalMs.toFixed(3)),
    averageMs: Number((totalMs / values.length).toFixed(3)),
  };
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
  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'HEAD',
      },
      timeoutMs
    );
    return response.ok;
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
  if (!config.ensureBuild && !config.ensureServer) {
    return null;
  }

  if (config.ensureBuild) {
    ensureProductionDistBuild();
  }

  if (!config.ensureServer) {
    return null;
  }

  if (await isUrlReachable(config.url, 1_000)) {
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
    scriptingMs: null,
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
    scriptingMs: Number(
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
  traceOutputPath: string
): string | null {
  if (trace == null) {
    return null;
  }

  mkdirSync(dirname(traceOutputPath), { recursive: true });
  writeFileSync(traceOutputPath, JSON.stringify(trace));
  return traceOutputPath;
}

async function profileVirtualizedRender(
  config: ProfileConfig,
  runNumber: number,
  traceOutputPath: string
): Promise<ProfileResult> {
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
    await navigateToFixture(cdp, config.url, config.timeoutMs);

    const { pageSummary, trace, cpuProfile } = await collectProfilingArtifacts(
      cdp,
      config.timeoutMs,
      async () => {
        await clickRenderButton(cdp);
        return await waitForProfileSummary(cdp, config.timeoutMs);
      }
    );
    const callCountsByFunction = config.includeCallCounts
      ? await collectFunctionCallCounts(cdp, config.url, config.timeoutMs)
      : null;

    return {
      runNumber,
      browserUrl: config.browserUrl,
      url: config.url,
      traceOutputPath: writeTraceIfAvailable(trace, traceOutputPath),
      renderedItemCount: pageSummary.renderedItemCount,
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
      trace: summarizeTrace(trace, pageSummary),
      cpuProfile: summarizeCpuProfile(cpuProfile, callCountsByFunction),
    };
  } finally {
    cdp.close();
    await closePageTarget(config.browserUrl, target.id, config.timeoutMs);
  }
}

function printRunHumanSummary(result: ProfileResult, totalRuns: number): void {
  const summaryRows = [['Visible rows', String(result.renderedItemCount)]];

  summaryRows.push(['Render ready', formatMs(result.renderDurationMs)]);

  if (result.trace.available) {
    if (result.trace.clickDispatchMs != null) {
      summaryRows.push([
        'Click dispatch task',
        formatMs(result.trace.clickDispatchMs),
      ]);
    }
    if (result.trace.clickToRenderReadyMs != null) {
      summaryRows.push([
        'Click-to-render-ready',
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
    summaryRows.push(['Scripting time', formatMs(result.trace.scriptingMs)]);
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

  if (result.trace.available && result.trace.dominantEvents.length > 0) {
    console.log('');
    console.log('Dominant Trace Events');
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

function printAggregateHumanSummary(results: ProfileResult[]): void {
  const aggregateRows = [
    summarizeAggregateMetric('Render ready', results, (result) => {
      return result.renderDurationMs;
    }),
    summarizeAggregateMetric('Click dispatch task', results, (result) => {
      return result.trace.clickDispatchMs;
    }),
    summarizeAggregateMetric('Click-to-render-ready', results, (result) => {
      return result.trace.clickToRenderReadyMs;
    }),
    summarizeAggregateMetric('Trace window', results, (result) => {
      return result.trace.windowDurationMs;
    }),
    summarizeAggregateMetric('Main-thread busy', results, (result) => {
      return result.trace.mainThreadBusyMs;
    }),
    summarizeAggregateMetric('Longest top-level task', results, (result) => {
      return result.trace.longestTaskMs;
    }),
    summarizeAggregateMetric('Sampled CPU time', results, (result) => {
      return result.cpuProfile.sampledMs;
    }),
  ];

  console.log('Aggregate Summary');
  console.log(
    createTable(
      ['Metric', 'Total', 'Average', 'Runs'],
      aggregateRows.map((row) => [
        row.label,
        formatMs(row.totalMs),
        formatMs(row.averageMs),
        `${row.availableRuns}/${results.length}`,
      ]),
      {
        alignments: ['left', 'right', 'right', 'right'],
        maxWidths: [28, 14, 14, 8],
      }
    )
  );
}

function printRunsHumanSummary(results: ProfileResult[]): void {
  if (results.length === 0) {
    return;
  }

  const runInfoRows = [
    ['Browser', results[0].browserUrl],
    ['URL', results[0].url],
    ['Runs', String(results.length)],
  ];

  console.log('Run Info');
  console.log(
    createTable(['Field', 'Value'], runInfoRows, {
      maxWidths: [16, 96],
    })
  );

  for (const [index, result] of results.entries()) {
    console.log('');
    printRunHumanSummary(result, results.length);
    if (index < results.length - 1) {
      console.log('');
    }
  }

  if (results.length > 1) {
    console.log('');
    printAggregateHumanSummary(results);
  }
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  let serverProcess: Bun.Subprocess | null = null;

  try {
    serverProcess = await startFixtureServerIfNeeded(config);
    const results: ProfileResult[] = [];
    for (let runNumber = 1; runNumber <= config.runs; runNumber += 1) {
      const traceOutputPath = createRunTraceOutputPath(
        config.traceOutputPath,
        runNumber,
        config.runs
      );
      const result = await profileVirtualizedRender(
        config,
        runNumber,
        traceOutputPath
      );
      results.push(result);
    }

    if (config.outputJson) {
      console.log(JSON.stringify({ runs: results }, null, 2));
    } else {
      printRunsHumanSummary(results);
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
