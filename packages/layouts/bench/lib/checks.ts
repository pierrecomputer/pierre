import type { Sample } from './measure';
import type { ContentWeight } from './scenarios';

/** The median sample of one scenario at one parameter set. */
export interface RecordSummary {
  scenario: string;
  panes: number;
  content: ContentWeight;
  steps: number;
  median: Sample;
}

/** The rules of the performance baseline in the `pierre-layouts` intent. */
export type Rule =
  | 'frame-rate'
  | 'main-thread'
  | 'time'
  | 'independence-from-content'
  | 'independence-of-layers'
  | 'compositing'
  | 'hidden-content'
  | 'scale';

export interface CheckResult {
  id: string;
  rule: Rule;
  description: string;
  value: number | null;
  limit: string;
  pass: boolean | null;
}

type Metric = keyof Sample;

interface Check {
  id: string;
  rule: Rule;
  description: string;
  limit: string;
  evaluate(find: Finder): { value: number; pass: boolean } | null;
}

type Finder = (
  scenario: string,
  panes: number,
  content: ContentWeight
) => RecordSummary | undefined;

// Allowed growth when a cost must not depend on content or on the number of panes.
const GROWTH = 1.25;

function atMost(
  scenario: string,
  panes: number,
  content: ContentWeight,
  metric: Metric,
  limit: number,
  perStep = false
): Check['evaluate'] {
  return (find) => {
    const record = find(scenario, panes, content);
    if (record === undefined) return null;
    const value = record.median[metric] / (perStep ? record.steps : 1);
    return { value, pass: value <= limit };
  };
}

// A frame check has no value when the trace holds no frames, for example after
// Chrome renames a trace field. Without this guard, such a check would pass.
function noFrames(
  scenario: string,
  panes: number,
  content: ContentWeight,
  metric: Metric
): Check['evaluate'] {
  const evaluate = atMost(scenario, panes, content, metric, 0);
  return (find) => {
    const record = find(scenario, panes, content);
    if (record === undefined) return null;
    const { framesPresented, framesPartial, framesDropped } = record.median;
    if (framesPresented + framesPartial + framesDropped === 0) return null;
    return evaluate(find);
  };
}

// The ratio of a metric between two parameter sets, for example heavy over light content.
function ratio(
  scenario: string,
  metric: Metric,
  numerator: [number, ContentWeight],
  denominator: [number, ContentWeight],
  floor: number
): Check['evaluate'] {
  return (find) => {
    const top = find(scenario, ...numerator);
    const bottom = find(scenario, ...denominator);
    if (top === undefined || bottom === undefined) return null;
    // A floor keeps tiny denominators from turning noise into a large ratio.
    const value =
      Math.max(top.median[metric], floor) /
      Math.max(bottom.median[metric], floor);
    return { value, pass: value <= GROWTH };
  };
}

const DISCRETE = ['zoom', 'restore', 'split', 'close', 'move', 'focus'];

export const CHECKS: Check[] = [
  {
    id: 'zoom-no-dropped-frames',
    rule: 'frame-rate',
    description: 'A zoom drops no frame (16 light panes).',
    limit: '0 frames',
    evaluate: noFrames('zoom', 16, 'light', 'framesDroppedAfterFirst'),
  },
  {
    id: 'resize-no-dropped-frames',
    rule: 'frame-rate',
    description: 'A resize drag drops no frame (16 heavy panes).',
    limit: '0 frames',
    evaluate: noFrames('resize', 16, 'heavy', 'framesDropped'),
  },
  {
    id: 'zoom-busy-no-dropped-frames',
    rule: 'main-thread',
    description:
      'A 200 ms long task during a zoom drops no frame of the animation (4 light panes).',
    limit: '0 frames',
    evaluate: noFrames('zoom-busy', 4, 'light', 'framesDroppedAfterFirst'),
  },
  {
    id: 'zoom-no-main-thread-animation',
    rule: 'main-thread',
    description: 'No frame of a zoom needs a main-thread animation.',
    limit: '0 frames',
    evaluate: noFrames('zoom', 4, 'light', 'framesWithMainAnimation'),
  },
  {
    id: 'zoom-animations-composited',
    rule: 'compositing',
    description: 'Every animation of a zoom runs on the compositor.',
    limit: '0 animations',
    evaluate: atMost('zoom', 4, 'light', 'animationsNotComposited', 0),
  },
  {
    id: 'split-animations-composited',
    rule: 'compositing',
    description: 'Every animation of a split runs on the compositor.',
    limit: '0 animations',
    evaluate: atMost('split', 4, 'light', 'animationsNotComposited', 0),
  },
  ...DISCRETE.map(
    (scenario): Check => ({
      id: `${scenario}-main-thread-budget`,
      rule: 'time',
      description: `A ${scenario} uses at most 4 ms of main-thread time (4 light panes).`,
      limit: '4 ms',
      evaluate: atMost(scenario, 4, 'light', 'mainThreadMs', 4),
    })
  ),
  {
    id: 'resize-main-thread-per-step',
    rule: 'time',
    description:
      'A resize drag uses at most 2 ms of main-thread time per pointer move (4 light panes).',
    limit: '2 ms',
    evaluate: atMost('resize', 4, 'light', 'mainThreadMs', 2, true),
  },
  {
    id: 'focus-no-content-render',
    rule: 'independence-from-content',
    description: 'A focus change renders no pane content (16 heavy panes).',
    limit: '0 renders',
    evaluate: atMost('focus', 16, 'heavy', 'contentRenders', 0),
  },
  {
    id: 'zoom-no-content-render',
    rule: 'independence-from-content',
    description: 'A zoom renders no pane content (16 heavy panes).',
    limit: '0 renders',
    evaluate: atMost('zoom', 16, 'heavy', 'contentRenders', 0),
  },
  {
    id: 'resize-no-content-render',
    rule: 'independence-from-content',
    description: 'A resize drag renders no pane content (16 heavy panes).',
    limit: '0 renders',
    evaluate: atMost('resize', 16, 'heavy', 'contentRenders', 0),
  },
  {
    id: 'zoom-one-content-resize',
    rule: 'independence-from-content',
    description:
      'A zoom resizes the content of the zoomed pane once, not once per frame.',
    limit: '1 callback',
    evaluate: atMost('zoom', 4, 'heavy', 'contentResizeCallbacks', 1),
  },
  {
    id: 'zoom-layout-once',
    rule: 'independence-from-content',
    description:
      'A zoom lays out at most twice: at the start and at the end (4 heavy panes).',
    limit: '2 layouts',
    evaluate: atMost('zoom', 4, 'heavy', 'layouts', 2),
  },
  {
    id: 'focus-style-independent-of-content',
    rule: 'independence-from-content',
    description:
      'The style work of a focus change does not grow with content (16 panes, heavy over light).',
    limit: `ratio ≤ ${GROWTH}`,
    evaluate: ratio('focus', 'styleElements', [16, 'heavy'], [16, 'light'], 10),
  },
  {
    id: 'resize-style-independent-of-content',
    rule: 'independence-from-content',
    description:
      'The style work of a resize drag does not grow with content (16 panes, heavy over light).',
    limit: `ratio ≤ ${GROWTH}`,
    evaluate: ratio(
      'resize',
      'styleElements',
      [16, 'heavy'],
      [16, 'light'],
      10
    ),
  },
  {
    id: 'zoom-time-independent-of-content',
    rule: 'independence-from-content',
    description:
      'The main-thread time of a zoom does not grow with content (16 panes, heavy over light).',
    limit: `ratio ≤ ${GROWTH}`,
    evaluate: ratio('zoom', 'mainThreadMs', [16, 'heavy'], [16, 'light'], 1),
  },
  {
    id: 'append-renders-one-pane',
    rule: 'independence-of-layers',
    description:
      'Output in one pane renders only that pane: one render per update (16 heavy panes).',
    limit: '1 render per update',
    evaluate: atMost('append', 16, 'heavy', 'contentRenders', 1, true),
  },
  {
    id: 'append-style-independent-of-panes',
    rule: 'independence-of-layers',
    description:
      'The style work of output in one pane does not grow with the number of panes (heavy, 16 over 4).',
    limit: `ratio ≤ ${GROWTH}`,
    evaluate: ratio('append', 'styleElements', [16, 'heavy'], [4, 'heavy'], 10),
  },
  {
    id: 'append-layout-independent-of-panes',
    rule: 'independence-of-layers',
    description:
      'The layout time of output in one pane does not grow with the number of panes (heavy, 16 over 4).',
    limit: `ratio ≤ ${GROWTH}`,
    evaluate: ratio('append', 'layoutMs', [16, 'heavy'], [4, 'heavy'], 0.5),
  },
  {
    id: 'append-time-independent-of-panes',
    rule: 'independence-of-layers',
    description:
      'The main-thread time of output in one pane does not grow with the number of panes (heavy, 16 over 4).',
    limit: `ratio ≤ ${GROWTH}`,
    evaluate: ratio('append', 'mainThreadMs', [16, 'heavy'], [4, 'heavy'], 1),
  },
  {
    id: 'hidden-append-no-layout',
    rule: 'hidden-content',
    description:
      'Output in a pane under a zoomed pane causes no layout (4 heavy panes).',
    limit: '0 ms',
    evaluate: atMost('hidden-append', 4, 'heavy', 'layoutMs', 0),
  },
  {
    id: 'hidden-append-no-paint',
    rule: 'hidden-content',
    description:
      'Output in a pane under a zoomed pane causes no paint (4 heavy panes).',
    limit: '0 paints',
    evaluate: atMost('hidden-append', 4, 'heavy', 'paints', 0),
  },
  ...['zoom', 'focus', 'split'].map(
    (scenario): Check => ({
      id: `${scenario}-time-independent-of-panes`,
      rule: 'scale',
      description: `The main-thread time of a ${scenario} does not grow with the number of panes (light, 16 over 4).`,
      limit: `ratio ≤ ${GROWTH}`,
      evaluate: ratio(scenario, 'mainThreadMs', [16, 'light'], [4, 'light'], 1),
    })
  ),
];

/** Evaluate every check against the medians of a benchmark run. */
export function evaluateChecks(records: RecordSummary[]): CheckResult[] {
  const find: Finder = (scenario, panes, content) =>
    records.find(
      (record) =>
        record.scenario === scenario &&
        record.panes === panes &&
        record.content === content
    );
  return CHECKS.map((check) => {
    const result = check.evaluate(find);
    return {
      id: check.id,
      rule: check.rule,
      description: check.description,
      limit: check.limit,
      value: result === null ? null : Number(result.value.toFixed(3)),
      pass: result?.pass ?? null,
    };
  });
}
