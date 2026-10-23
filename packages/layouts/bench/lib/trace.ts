/** Trace categories that hold main-thread tasks, rendering steps, frames, and animations. */
export const TRACE_CATEGORIES: string[] = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'toplevel',
  'blink',
  'blink.animations',
  'cc',
  'benchmark',
  'rail',
];

// The fields of Chrome trace event arguments that this summary reads.
interface TraceArgs {
  name?: string;
  elementCount?: number;
  data?: {
    frames?: { processId: number; isOutermostMainFrame?: boolean }[];
    compositeFailed?: number;
  };
  chrome_frame_reporter?: FrameReporter;
  // Chrome 155 writes the same data under this key.
  frame_reporter?: FrameReporter;
}

interface FrameReporter {
  state: string;
  has_main_animation?: boolean;
  has_compositor_animation?: boolean;
}

interface TraceEvent {
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
  prePaintMs: number;
  paints: number;
  paintMs: number;
  layerizeMs: number;
  framesPresented: number;
  framesPartial: number;
  framesDropped: number;
  framesWithMainAnimation: number;
  framesWithCompositorAnimation: number;
  animations: number;
  animationsNotComposited: number;
}

const ms = (microseconds: number): number => microseconds / 1000;

// The renderer of the page under test is the process of the outermost main frame.
function rendererPid(events: readonly TraceEvent[]): number | undefined {
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
    .map(
      (event) => event.args?.chrome_frame_reporter ?? event.args?.frame_reporter
    )
    .filter((frame) => frame !== undefined);
  const frameState = (state: string): number =>
    frames.filter((frame) => frame.state === state).length;

  // An animation is not composited when Blink reports a reason for it to run on the main thread.
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
          event.args?.data?.compositeFailed !== undefined
      )
      .map((event) => event.id2?.local ?? event.id2?.global)
  );

  return {
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
    prePaintMs: total(named('PrePaint')),
    paints: paints.length,
    paintMs: total(paints),
    layerizeMs: total(named('Layerize')),
    framesPresented: frameState('STATE_PRESENTED_ALL'),
    framesPartial: frameState('STATE_PRESENTED_PARTIAL'),
    framesDropped: frameState('STATE_DROPPED'),
    framesWithMainAnimation: frames.filter(
      (frame) => frame.has_main_animation === true
    ).length,
    framesWithCompositorAnimation: frames.filter(
      (frame) => frame.has_compositor_animation === true
    ).length,
    animations: animationStarts.length,
    animationsNotComposited: notComposited.size,
  };
}
