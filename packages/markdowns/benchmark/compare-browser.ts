import { pendingHighlights, Renderer, warmup } from 'benchmark-renderer';
import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';

import { createStressFixture } from './fixtures.mjs';
import './compare-browser.css';

const parameters = new URLSearchParams(location.search);
const scale = Number(parameters.get('scale') ?? 1) as 1 | 100 | 1000;
const mode = parameters.get('mode') ?? 'animated';
const source = createStressFixture(scale);
// Warm grammar and lazy modules without seeding the measured code-result cache.
const warmupSource =
  'Warmup **formatting**, *emphasis*, and [navigation](/warmup).\n\n' +
  '```typescript\nconst warmup: number = 1;\n```\n';
const chunk = 32 * scale;
const delay = 40;
const fadeDuration = 180;
const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) =>
  errors.push(String(event.reason))
);

type Measurements = {
  started: number;
  completed?: number;
  settled?: number;
  done: boolean;
  frames: number[];
  commits: number[];
  longTasks: { start: number; duration: number }[];
};
let measurements: Measurements | undefined;
let observer: PerformanceObserver | undefined;

/** Collect frame and task measurements only after warmup and an empty commit. */
function beginMeasurements(): void {
  measurements = {
    started: performance.now(),
    done: false,
    frames: [],
    commits: [],
    longTasks: [],
  };
  const current = measurements;
  let previous = current.started;
  const frame = (now: number): void => {
    if (current.done) return;
    if (current.completed === undefined) current.frames.push(now - previous);
    previous = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (entry.startTime >= current.started)
        current.longTasks.push({
          start: entry.startTime - current.started,
          duration: entry.duration,
        });
  });
  observer.observe({ type: 'longtask' });
}

/** Ignore differing code headers and newline wrappers when checking body text. */
function semanticOutput(): Record<string, unknown> {
  const preview = document.querySelector('#preview')!;
  const paragraphs = Array.from(preview.querySelectorAll('p'));
  const fences = Array.from(preview.querySelectorAll('pre code'));
  const text = [...paragraphs, ...fences]
    .map((node) => node.textContent ?? '')
    .join('')
    .replace(/\s+/g, '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  return {
    paragraphs: paragraphs.length,
    fences: fences.length,
    semanticCharacters: text.length,
    semanticHash: hash.toString(16),
    finalElements: preview.querySelectorAll('*').length,
    finalTextCharacters: preview.textContent?.length ?? 0,
    retainedFadeSpans: preview.querySelectorAll(
      '[data-markdown="token"], [data-sd-animate]'
    ).length,
    nativeContentVisibilityAuto: Array.from(
      preview.querySelectorAll('[style]')
    ).filter((node) => (node as HTMLElement).style.contentVisibility === 'auto')
      .length,
    highlightedFences: fences.filter(
      (node) =>
        node.querySelector('[style*="color"], [style*="shiki"]') !== null
    ).length,
  };
}

/** Summarize after settling; DOM counting and sorting are outside timed playback. */
function result(): Record<string, unknown> {
  const current = measurements;
  const percentile = (values: number[], fraction: number): number | null => {
    const ordered = values.slice().sort((a, b) => a - b);
    return ordered[Math.floor(ordered.length * fraction)] ?? null;
  };
  return {
    mode,
    scale,
    characters: source.length,
    chunk,
    delay,
    expectedUpdates: Math.ceil(source.length / chunk),
    done: current?.done ?? false,
    elapsed:
      current?.completed !== undefined
        ? current.completed - current.started
        : null,
    settledElapsed:
      current?.settled !== undefined ? current.settled - current.started : null,
    committedUpdates: current?.commits.length ?? 0,
    commitP50: percentile(current?.commits ?? [], 0.5),
    commitP95: percentile(current?.commits ?? [], 0.95),
    commitP99: percentile(current?.commits ?? [], 0.99),
    maxCommit: Math.max(0, ...(current?.commits ?? [])),
    commitTotal: current?.commits.reduce((sum, value) => sum + value, 0) ?? 0,
    frames: current?.frames.length ?? 0,
    frameP95: percentile(current?.frames ?? [], 0.95),
    frameP99: percentile(current?.frames ?? [], 0.99),
    maxFrame: Math.max(0, ...(current?.frames ?? [])),
    longTaskCount: current?.longTasks.length ?? 0,
    longTaskTotal:
      current?.longTasks.reduce((sum, task) => sum + task.duration, 0) ?? 0,
    maxLongTask: Math.max(
      0,
      ...(current?.longTasks.map((task) => task.duration) ?? [])
    ),
    longTasks: current?.longTasks ?? [],
    pendingHighlights: pendingHighlights(),
    errors,
    ...semanticOutput(),
  };
}

const benchmark = {
  ready: false,
  done: false,
  start: () => {},
  reset: () => {},
  showAll: () => {},
  result,
};
Object.assign(window, { markdownComparison: benchmark });

/** Commit-paced production playback supplies every prefix to both renderers. */
function App() {
  const [stage, setStage] = useState<'warmup' | 'idle' | 'playing' | 'all'>(
    'warmup'
  );
  const [cursor, setCursor] = useState(0);
  const [generation, setGeneration] = useState(0);
  const requested = useRef<number | undefined>(undefined);
  const active = stage === 'playing' && cursor < source.length;
  const value =
    stage === 'warmup'
      ? warmupSource
      : stage === 'all'
        ? source
        : source.slice(0, cursor);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await warmup(mode !== 'plain');
      // The highlighted body itself is a lazy module in Streamdown.
      await new Promise((resolve) => setTimeout(resolve, 750));
      if (!cancelled) {
        setGeneration((value) => value + 1);
        setStage('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (stage === 'idle') {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          benchmark.ready = true;
        })
      );
    }
    if (stage !== 'playing' || measurements === undefined) return;
    if (requested.current !== undefined) {
      measurements.commits.push(performance.now() - requested.current);
      requested.current = undefined;
    }
    if (cursor === source.length) measurements.completed = performance.now();
  }, [stage, cursor, generation]);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      requested.current = performance.now();
      setCursor((value) => Math.min(source.length, value + chunk));
    }, delay);
    return () => clearTimeout(timer);
  }, [active, cursor]);

  useEffect(() => {
    if (stage !== 'playing' || cursor !== source.length) return;
    // Wait for asynchronous code results and fade expiry before output checks.
    const timer = setInterval(() => {
      const current = measurements!;
      if (
        pendingHighlights() !== 0 ||
        performance.now() - current.completed! < fadeDuration + 150
      )
        return;
      clearInterval(timer);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          for (const entry of observer?.takeRecords() ?? [])
            if (entry.startTime >= current.started)
              current.longTasks.push({
                start: entry.startTime - current.started,
                duration: entry.duration,
              });
          current.settled = performance.now();
          current.done = true;
          observer?.disconnect();
          benchmark.done = true;
        })
      );
    }, 30);
    return () => clearInterval(timer);
  }, [stage, cursor]);

  useEffect(() => {
    benchmark.start = () => {
      if (!benchmark.ready) throw new Error('Warmup has not finished');
      benchmark.done = false;
      benchmark.ready = false;
      beginMeasurements();
      setStage('playing');
    };
    benchmark.reset = () => {
      benchmark.ready = false;
      benchmark.done = false;
      if (measurements !== undefined) measurements.done = true;
      observer?.disconnect();
      setCursor(0);
      setGeneration((value) => value + 1);
      setStage('idle');
    };
    benchmark.showAll = () => {
      benchmark.ready = false;
      setStage('all');
    };
  }, []);

  return createElement(
    'main',
    null,
    createElement(
      'div',
      { id: 'preview', 'data-cursor': cursor, 'data-stage': stage },
      createElement(Renderer, {
        key: generation,
        value,
        active,
        highlight: mode !== 'plain',
        animated: mode === 'animated',
      })
    )
  );
}

createRoot(document.getElementById('app')!).render(createElement(App));
