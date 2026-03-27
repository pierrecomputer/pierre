import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ProfileConfig {
  browserUrl: string;
  url: string;
  timeoutMs: number;
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
  dominantEvents: Array<{ name: string; durationMs: number }>;
}

interface ProfileResult {
  browserUrl: string;
  url: string;
  traceOutputPath: string | null;
  renderedItemCount: number;
  renderDurationMs: number;
  longTaskCount: number | null;
  longTaskTotalMs: number | null;
  longestLongTaskMs: number | null;
  trace: TraceSummary;
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

function parseArgs(argv: string[]): ProfileConfig {
  const config: ProfileConfig = {
    browserUrl: DEFAULT_BROWSER_URL,
    url: DEFAULT_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
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
): Array<{ name: string; durationMs: number }> {
  const totalsByName = new Map<string, number>();

  for (const event of events) {
    if (
      event.name === '' ||
      ignoredNames.has(event.name) ||
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
    }))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 5);
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

async function tryCollectTrace(
  cdp: CdpClient,
  timeoutMs: number,
  action: () => Promise<PageRenderSummary>
): Promise<{ pageSummary: PageRenderSummary; trace: TraceFile | null }> {
  let tracePromise: Promise<TraceFile> | null = null;

  try {
    tracePromise = startTrace(cdp);
  } catch {
    tracePromise = null;
  }

  const pageSummary = await action();

  if (tracePromise == null) {
    return { pageSummary, trace: null };
  }

  try {
    await cdp.send('Tracing.end');
    const trace = await withTimeout(
      tracePromise,
      Math.max(timeoutMs, TRACE_COMPLETION_TIMEOUT_MS),
      'Timed out waiting for trace completion'
    );
    return { pageSummary, trace };
  } catch {
    return { pageSummary, trace: null };
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
  config: ProfileConfig
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

    const { pageSummary, trace } = await tryCollectTrace(
      cdp,
      config.timeoutMs,
      async () => {
        await clickRenderButton(cdp);
        return await waitForProfileSummary(cdp, config.timeoutMs);
      }
    );

    const savedTracePath = writeTraceIfAvailable(trace, config.traceOutputPath);
    return {
      browserUrl: config.browserUrl,
      url: config.url,
      traceOutputPath: savedTracePath,
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
    };
  } finally {
    cdp.close();
    await closePageTarget(config.browserUrl, target.id, config.timeoutMs);
  }
}

function printHumanSummary(result: ProfileResult): void {
  console.log(`Browser: ${result.browserUrl}`);
  console.log(`URL: ${result.url}`);
  console.log(`Rendered rows in initial window: ${result.renderedItemCount}`);
  console.log(
    `Page-measured render ready: ${formatMs(result.renderDurationMs)}`
  );

  if (result.trace.available) {
    if (result.trace.clickDispatchMs != null) {
      console.log(
        `Click dispatch task: ${formatMs(result.trace.clickDispatchMs)}`
      );
    }
    if (result.trace.clickToRenderReadyMs != null) {
      console.log(
        `Click-to-render-ready: ${formatMs(result.trace.clickToRenderReadyMs)}`
      );
    }
    console.log(`Trace window: ${formatMs(result.trace.windowDurationMs)}`);
    console.log(
      `Main-thread busy time: ${formatMs(result.trace.mainThreadBusyMs)}`
    );
    console.log(
      `Longest top-level task: ${formatMs(result.trace.longestTaskMs)}`
    );
    console.log(
      `Top-level task count: ${result.trace.topLevelTaskCount ?? 'n/a'}`
    );
    console.log(`Scripting time: ${formatMs(result.trace.scriptingMs)}`);
    console.log(`GC time: ${formatMs(result.trace.gcMs)}`);
    console.log(`Style/layout time: ${formatMs(result.trace.styleLayoutMs)}`);
    console.log(
      `Paint/composite time: ${formatMs(result.trace.paintCompositeMs)}`
    );

    if (result.trace.dominantEvents.length > 0) {
      console.log(
        `Dominant trace events: ${result.trace.dominantEvents
          .map((event) => `${event.name} (${event.durationMs.toFixed(2)} ms)`)
          .join(', ')}`
      );
    }
  } else {
    console.log('Trace summary: unavailable');
  }

  if (result.traceOutputPath != null) {
    console.log(`Trace saved to: ${result.traceOutputPath}`);
  }
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  let serverProcess: Bun.Subprocess | null = null;

  try {
    serverProcess = await startFixtureServerIfNeeded(config);
    const result = await profileVirtualizedRender(config);

    if (config.outputJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHumanSummary(result);
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
