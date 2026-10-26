import dark from '@pierre/highlights/themes/pierre-dark';
import light from '@pierre/highlights/themes/pierre-light';
import { createHighlightsPlugin } from '@pierre/words/highlights';
import { Markdown } from '@pierre/words/react';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import {
  createFenceFixture,
  fenceHash,
  fencePercentile,
} from './fence-fixture';
import '../react/styles.css';
import './fence-browser.css';

const parameters = new URLSearchParams(location.search);
const lineCount = Number(parameters.get('lines') ?? 1000);
const lineNumbers = parameters.get('numbers') !== 'false';
const diagnostic = parameters.get('diagnostic') === 'true';
const delay = Number(parameters.get('delay') ?? 0);
const fixture = createFenceFixture(lineCount);
const code = createHighlightsPlugin({
  themes: { light, dark },
  defaultColor: 'light-dark()',
});
const plugins = { code };
const preview = document.getElementById('preview')!;
const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) =>
  errors.push(String(event.reason))
);
let root = createRoot(preview);

/** Keep framework work identical while supplying every growing source prefix. */
function render(value: string, active: boolean): void {
  flushSync(() =>
    root.render(
      createElement(
        Markdown,
        {
          mode: 'streaming',
          isAnimating: active,
          animated: false,
          controls: false,
          lineNumbers,
          plugins,
        },
        value
      )
    )
  );
}

type Measurements = {
  started: number;
  completed?: number;
  settled?: number;
  done: boolean;
  updates: number[];
  frames: number[];
  longTasks: number[];
};
let measurements: Measurements | undefined;
const work = {
  templateAssignments: 0,
  templateHtmlCharacters: 0,
  mutationRecords: 0,
  addedNodes: 0,
  removedNodes: 0,
  characterDataMutations: 0,
  attributeMutations: 0,
  firstSpanIdentityChecks: 0,
  firstSpanReplacements: 0,
};
let restoreTemplate: (() => void) | undefined;
let mutations: MutationObserver | undefined;
let firstSpan: Element | null = null;

/** Instrument native HTML parsing only in a separate pass, outside primary timings. */
function instrument(): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'innerHTML'
  )!;
  Object.defineProperty(Element.prototype, 'innerHTML', {
    ...descriptor,
    set(this: Element, value: string) {
      if (this instanceof HTMLTemplateElement) {
        work.templateAssignments++;
        work.templateHtmlCharacters += value.length;
      }
      descriptor.set!.call(this, value);
    },
  });
  restoreTemplate = () =>
    Object.defineProperty(Element.prototype, 'innerHTML', descriptor);
  mutations = new MutationObserver(() => {});
  mutations.observe(preview, {
    childList: true,
    characterData: true,
    attributes: true,
    subtree: true,
  });
}

/** Count mutations after a commit without retaining references to removed nodes. */
function collectMutations(): void {
  for (const record of mutations?.takeRecords() ?? []) {
    work.mutationRecords++;
    work.addedNodes += record.addedNodes.length;
    work.removedNodes += record.removedNodes.length;
    if (record.type === 'characterData') work.characterDataMutations++;
    if (record.type === 'attributes') work.attributeMutations++;
  }
  const current = preview.querySelector('pre code span');
  if (firstSpan === null) firstSpan = current;
  else {
    work.firstSpanIdentityChecks++;
    if (current !== firstSpan) work.firstSpanReplacements++;
  }
}

/** Yield a native task between deliveries without the nested-timer four-ms clamp. */
function nextDelivery(): Promise<void> {
  if (delay > 0) return new Promise((resolve) => setTimeout(resolve, delay));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Summarize after playback and paint; expensive output checks never affect timed updates. */
function result() {
  const codeElement = preview.querySelector('pre code');
  const text = codeElement?.textContent ?? '';
  const numberText = preview.querySelector(
    '[data-markdown="line-numbers"]'
  )?.textContent;
  const expectedNumbers = Array.from({ length: lineCount }, (_, index) =>
    String(index + 1)
  ).join('\n');
  const current = measurements;
  return {
    lineCount,
    lineNumbers,
    diagnostic,
    delay,
    characters: fixture.source.length,
    linesPerDelivery: fixture.linesPerDelivery,
    expectedUpdates: fixture.ends.length,
    committedUpdates: current?.updates.length ?? 0,
    elapsed:
      current?.completed === undefined
        ? null
        : current.completed - current.started,
    settledElapsed:
      current?.settled === undefined ? null : current.settled - current.started,
    updateP50: fencePercentile(current?.updates ?? [], 0.5),
    updateP95: fencePercentile(current?.updates ?? [], 0.95),
    maxUpdate: Math.max(0, ...(current?.updates ?? [])),
    updateTotal: current?.updates.reduce((sum, value) => sum + value, 0) ?? 0,
    frameP95: fencePercentile(current?.frames ?? [], 0.95),
    maxFrame: Math.max(0, ...(current?.frames ?? [])),
    longTaskCount: current?.longTasks.length ?? 0,
    longTaskTotal:
      current?.longTasks.reduce((sum, value) => sum + value, 0) ?? 0,
    finalCodeCharacters: text.length,
    finalCodeHash: fenceHash(text),
    expectedCodeHash: fenceHash(fixture.code),
    finalCodeParity: text === fixture.code,
    finalLineNumberParity: lineNumbers
      ? numberText === expectedNumbers
      : numberText == null,
    finalElements: preview.querySelectorAll('*').length,
    finalHighlightedSpans: codeElement?.querySelectorAll('span').length ?? 0,
    retainedFadeSpans: preview.querySelectorAll('[data-markdown="token"]')
      .length,
    ...(diagnostic ? { work } : {}),
    errors,
  };
}

const benchmark = {
  ready: false,
  done: false,
  error: null as string | null,
  start: () => {},
  result,
};
Object.assign(window, { markdownFence: benchmark });

/** Warm a different fence, then create a fresh empty Markdown instance before measuring. */
async function initialize(): Promise<void> {
  render('```typescript\nconst warmup: number = 1;\n```\n', false);
  flushSync(() => root.unmount());
  root = createRoot(preview);
  render('', false);
  await nextFrame();
  await nextFrame();
  benchmark.ready = true;
  benchmark.start = () => {
    if (!benchmark.ready) throw new Error('Benchmark is not ready');
    benchmark.ready = false;
    void playback().catch((error: unknown) => {
      benchmark.error = String(error);
      errors.push(String(error));
      benchmark.done = true;
      restoreTemplate?.();
      mutations?.disconnect();
    });
  };
}

/** Capture synchronous commits and independent frame intervals with animation disabled. */
async function playback(): Promise<void> {
  if (diagnostic) instrument();
  const current: Measurements = {
    started: performance.now(),
    done: false,
    updates: [],
    frames: [],
    longTasks: [],
  };
  measurements = current;
  let previous = current.started;
  const frame = (now: number): void => {
    if (current.done) return;
    if (current.completed === undefined) current.frames.push(now - previous);
    previous = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (entry.startTime >= current.started)
        current.longTasks.push(entry.duration);
  });
  observer.observe({ type: 'longtask' });
  for (const end of fixture.ends) {
    await nextDelivery();
    const start = performance.now();
    render(fixture.source.slice(0, end), end < fixture.source.length);
    current.updates.push(performance.now() - start);
    if (diagnostic) collectMutations();
  }
  current.completed = performance.now();
  await nextFrame();
  await nextFrame();
  for (const entry of observer.takeRecords())
    if (entry.startTime >= current.started)
      current.longTasks.push(entry.duration);
  observer.disconnect();
  current.settled = performance.now();
  current.done = true;
  if (diagnostic) collectMutations();
  restoreTemplate?.();
  mutations?.disconnect();
  benchmark.done = true;
}

void initialize().catch((error: unknown) => {
  benchmark.error = String(error);
  errors.push(String(error));
  benchmark.done = true;
});
