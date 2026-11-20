/** Trace categories that hold main-thread tasks, rendering steps, frames, and animations. */
export const TRACE_CATEGORIES: string[] = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  // Stack traces mark a layout or a style update that script forced.
  'disabled-by-default-devtools.timeline.stack',
  'toplevel',
  'blink',
  'blink.animations',
  'cc',
  'benchmark',
  'rail',
];

/**
 * Categories of the attribution run: invalidation tracking names each node that
 * a change marks for style or layout. The tracking costs time, so the timed
 * runs do not use it.
 */
export const ATTRIBUTION_CATEGORIES: string[] = [
  ...TRACE_CATEGORIES,
  'disabled-by-default-devtools.timeline.invalidationTracking',
];

// The fields of Chrome trace event arguments that the harness reads.
interface TraceArgs {
  name?: string;
  elementCount?: number;
  beginData?: { stackTrace?: unknown[] };
  data?: {
    frames?: { processId: number; isOutermostMainFrame?: boolean }[];
    compositeFailed?: number;
    nodeId?: number;
    nodeName?: string;
    reason?: string;
  };
  chrome_frame_reporter?: FrameReporter;
  // Chrome 155 writes the same data under this key.
  frame_reporter?: FrameReporter;
  // A memory-infra dump of one process (`ph: 'v'`). Sizes are hexadecimal strings.
  dumps?: {
    process_totals?: { private_footprint_bytes?: string };
    allocators?: Record<string, AllocatorDump>;
  };
}

/** One allocator of a memory-infra dump, for example `v8` or `cc/tile_memory/provider_0/resource_1`. */
export interface AllocatorDump {
  attrs?: Record<string, { type: string; units?: string; value: string }>;
}

interface FrameReporter {
  state: string;
  has_main_animation?: boolean;
  has_compositor_animation?: boolean;
}

export interface TraceEvent {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  id2?: { local?: string; global?: string };
  args?: TraceArgs;
}

/** Rendering work on the renderer main thread, frames, and animations in one traced operation. */
export interface TraceSummary {
  mainThreadMs: number;
  longestTaskMs: number;
  styleRecalcs: number;
  styleElements: number;
  styleMs: number;
  layouts: number;
  layoutMs: number;
  forcedLayouts: number;
  prePaintMs: number;
  paints: number;
  paintMs: number;
  layerizeMs: number;
  framesPresented: number;
  framesPartial: number;
  framesDropped: number;
  framesDroppedAfterFirst: number;
  framesWithMainAnimation: number;
  framesWithCompositorAnimation: number;
  animations: number;
  animationsNotComposited: number;
  // The time of top-level tasks by the kind of work, from the self time of
  // each event. These parts add up to `mainThreadMs`.
  taskScriptMs: number;
  taskStyleMs: number;
  taskLayoutMs: number;
  taskPrePaintMs: number;
  taskPaintMs: number;
  taskLayerizeMs: number;
  taskCommitMs: number;
  taskGcMs: number;
  taskOtherMs: number;
}

type TaskKind =
  | 'Script'
  | 'Style'
  | 'Layout'
  | 'PrePaint'
  | 'Paint'
  | 'Layerize'
  | 'Commit'
  | 'Gc'
  | 'Other';

// The kind of work of a trace event, by its name. The order matters: a name
// such as `UpdateLayoutTree` holds `Layout` but is style work.
function kindOfTask(name: string): TaskKind {
  if (/GC|^MinorGC|^MajorGC|BlinkGC|CppGC/.test(name)) return 'Gc';
  if (
    /^(FunctionCall|EvaluateScript|TimerFire|EventDispatch|FireAnimationFrame|RunMicrotasks|FireIdleCallback|AsyncTask Run|ParseHTML)$/.test(
      name
    ) ||
    /^(v8|V8)\./.test(name)
  )
    return 'Script';
  if (/UpdateLayoutTree|RecalculateStyles|Style/.test(name)) return 'Style';
  if (/PrePaint/.test(name)) return 'PrePaint';
  if (
    /Layerize|PaintArtifactCompositor|pushPaintArtifactToCompositor|Compositing/.test(
      name
    )
  )
    return 'Layerize';
  if (/CullRect/.test(name)) return 'PrePaint';
  if (/Layout/.test(name)) return 'Layout';
  if (/Paint/.test(name)) return 'Paint';
  if (/[Cc]ommit/.test(name)) return 'Commit';
  return 'Other';
}

/**
 * Split the time of top-level tasks into kinds of work. Each event counts its
 * self time: its duration less that of the events that it holds.
 */
function taskBreakdown(main: readonly TraceEvent[]): {
  kinds: Record<TaskKind, number>;
  other: Map<string, number>;
} {
  const events = main
    .filter((event) => event.ph === 'X')
    .sort((a, b) =>
      a.ts === b.ts ? (b.dur ?? 0) - (a.dur ?? 0) : a.ts - b.ts
    );
  const kinds: Record<TaskKind, number> = {
    Script: 0,
    Style: 0,
    Layout: 0,
    PrePaint: 0,
    Paint: 0,
    Layerize: 0,
    Commit: 0,
    Gc: 0,
    Other: 0,
  };
  const other = new Map<string, number>();
  const stack: { event: TraceEvent; children: number; inTask: boolean }[] = [];
  const close = (item: (typeof stack)[number]): void => {
    if (!item.inTask) return;
    const self = Math.max(0, (item.event.dur ?? 0) - item.children);
    const kind = kindOfTask(item.event.name);
    kinds[kind] += self;
    if (kind === 'Other')
      other.set(item.event.name, (other.get(item.event.name) ?? 0) + self);
  };
  for (const event of events) {
    while (
      stack.length > 0 &&
      stack[stack.length - 1].event.ts +
        (stack[stack.length - 1].event.dur ?? 0) <=
        event.ts
    )
      close(stack.pop()!);
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children += event.dur ?? 0;
    // Only the work of top-level tasks counts, as in `mainThreadMs`.
    const inTask =
      parent === undefined ? event.name === 'RunTask' : parent.inTask;
    stack.push({ event, children: 0, inTask });
  }
  while (stack.length > 0) close(stack.pop()!);
  return { kinds, other };
}

/** One node that a change marked for style or layout, from invalidation tracking. */
export interface Invalidation {
  kind: 'style' | 'layout';
  nodeId: number;
  nodeName: string;
  reason: string;
}

/** What the attribution run reads from its trace, besides the summary. */
export interface TraceAnalysis {
  summary: TraceSummary;
  /** The largest kinds of work that the breakdown does not name, in ms. */
  otherTasks: { name: string; ms: number }[];
  invalidations: Invalidation[];
}

const ms = (microseconds: number): number => microseconds / 1000;

// The renderer of the page under test is the process of the outermost main frame.
export function rendererPid(events: readonly TraceEvent[]): number | undefined {
  const started = events.find(
    (event) => event.name === 'TracingStartedInBrowser'
  );
  const frames = started?.args?.data?.frames;
  return (
    frames?.find((frame) => frame.isOutermostMainFrame === true) ?? frames?.[0]
  )?.processId;
}

function mainThreadTid(
  events: readonly TraceEvent[],
  pid: number
): number | undefined {
  return events.find(
    (event) =>
      event.ph === 'M' &&
      event.name === 'thread_name' &&
      event.pid === pid &&
      event.args?.name === 'CrRendererMain'
  )?.tid;
}

/** Sum only top-level tasks, so that a nested task does not count twice. */
function topLevelTaskDurations(tasks: TraceEvent[]): number[] {
  tasks.sort((a, b) => a.ts - b.ts);
  const durations: number[] = [];
  let end = -Infinity;
  for (const task of tasks) {
    if (task.ts >= end) {
      durations.push(task.dur ?? 0);
      end = task.ts + (task.dur ?? 0);
    }
  }
  return durations;
}

/** Reduce a Chrome trace to the counts and durations that the baseline rules use. */
export function summarizeTrace(traceJson: string): TraceSummary {
  return analyzeTrace(traceJson).summary;
}

/** Summarize a trace, and read the work that it does not name and its invalidations. */
export function analyzeTrace(traceJson: string): TraceAnalysis {
  const parsed = JSON.parse(traceJson) as
    | { traceEvents: TraceEvent[] }
    | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const pid = rendererPid(events);
  if (pid === undefined) throw new Error('The trace has no page renderer');
  const tid = mainThreadTid(events, pid);
  const main = events.filter(
    (event) => event.pid === pid && event.tid === tid && event.ph === 'X'
  );
  const named = (name: string): TraceEvent[] =>
    main.filter((event) => event.name === name);
  const total = (list: TraceEvent[]): number =>
    ms(list.reduce((sum, event) => sum + (event.dur ?? 0), 0));

  const tasks = topLevelTaskDurations(named('RunTask'));
  const styles = [...named('UpdateLayoutTree'), ...named('RecalculateStyles')];
  const layouts = named('Layout');
  const paints = named('Paint');

  // Each frame of the page's compositor reports one state when it begins.
  const frames = events
    .filter(
      (event) =>
        event.pid === pid &&
        event.name === 'PipelineReporter' &&
        event.ph === 'b'
    )
    .sort((a, b) => a.ts - b.ts)
    .map(
      (event) => event.args?.chrome_frame_reporter ?? event.args?.frame_reporter
    )
    .filter((frame) => frame !== undefined);
  const frameState = (state: string): number =>
    frames.filter((frame) => frame.state === state).length;
  // A compositor animation needs one main-thread frame to start, so its first
  // frame can drop for a reason that is not the animation itself.
  const expected = frames.filter(
    (frame) => frame.state !== 'STATE_NO_UPDATE_DESIRED'
  );
  const droppedAfterFirst = expected
    .slice(1)
    .filter((frame) => frame.state === 'STATE_DROPPED').length;

  // An animation is not composited when Blink reports a nonzero reason for it to run on the main thread.
  const animationStarts = events.filter(
    (event) =>
      event.pid === pid && event.name === 'Animation' && event.ph === 'b'
  );
  const notComposited = new Set(
    events
      .filter(
        (event) =>
          event.pid === pid &&
          event.name === 'Animation' &&
          event.ph === 'n' &&
          // Chromium reports 0 for an animation that the compositor runs.
          (event.args?.data?.compositeFailed ?? 0) !== 0
      )
      .map((event) => event.id2?.local ?? event.id2?.global)
  );

  const { kinds, other } = taskBreakdown(
    events.filter((event) => event.pid === pid && event.tid === tid)
  );
  const invalidations: Invalidation[] = events
    .filter(
      (event) =>
        event.pid === pid &&
        (event.name === 'LayoutInvalidationTracking' ||
          event.name === 'StyleRecalcInvalidationTracking') &&
        typeof event.args?.data?.nodeId === 'number'
    )
    .map((event) => ({
      kind: event.name === 'LayoutInvalidationTracking' ? 'layout' : 'style',
      nodeId: event.args?.data?.nodeId ?? 0,
      nodeName: event.args?.data?.nodeName ?? '',
      reason: event.args?.data?.reason ?? '',
    }));

  const summary: TraceSummary = {
    mainThreadMs: ms(tasks.reduce((sum, value) => sum + value, 0)),
    longestTaskMs: ms(Math.max(0, ...tasks)),
    styleRecalcs: styles.length,
    styleElements: styles.reduce(
      (sum, event) => sum + Number(event.args?.elementCount ?? 0),
      0
    ),
    styleMs: total(styles),
    layouts: layouts.length,
    layoutMs: total(layouts),
    forcedLayouts: layouts.filter(
      (event) => (event.args?.beginData?.stackTrace?.length ?? 0) > 0
    ).length,
    prePaintMs: total(named('PrePaint')),
    paints: paints.length,
    paintMs: total(paints),
    layerizeMs: total(named('Layerize')),
    framesPresented: frameState('STATE_PRESENTED_ALL'),
    framesPartial: frameState('STATE_PRESENTED_PARTIAL'),
    framesDropped: frameState('STATE_DROPPED'),
    framesDroppedAfterFirst: droppedAfterFirst,
    framesWithMainAnimation: frames.filter(
      (frame) => frame.has_main_animation === true
    ).length,
    framesWithCompositorAnimation: frames.filter(
      (frame) => frame.has_compositor_animation === true
    ).length,
    animations: animationStarts.length,
    animationsNotComposited: notComposited.size,
    taskScriptMs: ms(kinds.Script),
    taskStyleMs: ms(kinds.Style),
    taskLayoutMs: ms(kinds.Layout),
    taskPrePaintMs: ms(kinds.PrePaint),
    taskPaintMs: ms(kinds.Paint),
    taskLayerizeMs: ms(kinds.Layerize),
    taskCommitMs: ms(kinds.Commit),
    taskGcMs: ms(kinds.Gc),
    taskOtherMs: ms(kinds.Other),
  };
  return {
    summary,
    otherTasks: [...other]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, time]) => ({ name, ms: Number(ms(time).toFixed(3)) })),
    invalidations,
  };
}
