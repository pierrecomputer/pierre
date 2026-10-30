import type { MemorySample } from './types';

type Entry = Partial<MemorySample> & {
  playbackSamples: {
    elements: number;
    pierreFadeWrappers: number;
    streamdownFadeWrappers: number;
  }[];
};

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  browserArguments,
  browserCommand,
  environmentMetadata,
} from './environment.ts';

const [
  baseUrl,
  outputFile,
  mode = 'animated',
  scaleText = '100',
  runsText = '3',
] = process.argv.slice(2);
if ((baseUrl ?? '') === '' || (outputFile ?? '') === '')
  throw new Error('Expected benchmark server URL and output JSON path');
const scale = Number(scaleText);
const runs = Number(runsText);
if (!Number.isInteger(runs) || runs < 1 || runs > 3)
  throw new Error('Runs must be 1, 2, or 3');
if (
  !['plain', 'highlight', 'animated'].includes(mode) ||
  ![1, 100, 1000].includes(scale)
)
  throw new Error(
    'Expected [baseURL] [output.json] [plain|highlight|animated] [1|100|1000]'
  );
const report = {
  environment: environmentMetadata({ browser: true }),
  date: new Date().toISOString(),
  mode,
  scale,
  runs,
  samples: [] as Entry[],
  notes: [
    'One fresh browser per provider, same warmed empty renderer and commit-paced replay as timing comparison.',
    'Memory sampling runs separately from primary timings, with exposed GC and precise Chromium heap reporting.',
    'Heap is performance.memory.usedJSHeapSize after two explicit GCs separated by turns and frames. It excludes native DOM, graphics resources, and complete Wasm allocation accounting.',
    'DOM counts are structural observations, not retained byte estimates. Source, module imports and warmed global caches are included in baseline.',
    'Reset remounts an empty renderer and releases the old rendering state; shared arenas and global code caches may intentionally remain.',
    'Once-per-second active wrapper/element samples are allocation diagnostics that perturb replay timing; sampled peaks are not exact peaks. No forced GC runs during playback.',
    'Each sample uses a fresh browser; heap deltas are not a leak proof or total-memory comparison.',
  ],
};
mkdirSync(dirname(resolve(outputFile)), { recursive: true });
let session: string;
let opened = false;
const browser = (...args: string[]) =>
  execFileSync(browserCommand(), browserArguments(session, args), {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30000,
  });
const save = () =>
  writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
const sampleScript = `(async () => {
  if (typeof globalThis.gc !== 'function' || !performance.memory) throw new Error('Explicit GC/heap reporting unavailable');
  for (let i=0;i<2;i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    globalThis.gc();
  }
  const heapUsed = performance.memory.usedJSHeapSize;
  const heapTotal = performance.memory.totalJSHeapSize;
  const preview = document.querySelector('#preview');
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
  let textNodes=0, textCharacters=0, node;
  while ((node=walker.nextNode())) { textNodes++; textCharacters+=node.textContent.length; }
  return { userAgent:navigator.userAgent, brands:navigator.userAgentData?.brands ?? null, heapUsed, heapTotal, elements:preview.querySelectorAll('*').length, textNodes, textCharacters,
    paragraphs:preview.querySelectorAll('p').length, fences:preview.querySelectorAll('pre code').length,
    fadeSpans:preview.querySelectorAll('[data-markdown="token"],[data-sd-animate]').length,
    pendingHighlights:window.markdownComparison.result().pendingHighlights,
    errors:window.markdownComparison.result().errors };
})()`;
try {
  for (const run of Array.from({ length: runs }, (_, index) => index))
    for (const library of run % 2 !== 0
      ? ['streamdown', 'pierre']
      : ['pierre', 'streamdown']) {
      session = `words-comparison-memory-${process.pid}-${run}-${library}`;
      const entry: Entry = { library, mode, scale, run, playbackSamples: [] };
      try {
        browser(
          '--args',
          '--js-flags=--expose-gc,--enable-precise-memory-info',
          'open',
          `${baseUrl}/${library}/index.html?scale=${scale}&mode=${mode}`
        );
        opened = true;
        browser('set', 'viewport', '1280', '960');
        browser('wait', '--fn', 'window.markdownComparison?.ready === true');
        entry.baseline = JSON.parse(browser('eval', sampleScript));
        browser('eval', 'window.markdownComparison.start();true');
        const deadline = Date.now() + 180000;
        while (true) {
          const activeSample = JSON.parse(
            browser(
              'eval',
              `(() => {
          const preview=document.querySelector('#preview');
          const cursor=Number(preview.dataset.cursor);
          const sourceLength=${8524 * scale + (scale - 1) * 2};
          return {done:window.markdownComparison?.done === true, at:performance.now(), cursor, sourceLength, progress:cursor/sourceLength, elements:preview.querySelectorAll('*').length, pierreFadeWrappers:preview.querySelectorAll('[data-markdown=token]').length, streamdownFadeWrappers:preview.querySelectorAll('[data-sd-animate]').length};
        })()`
            )
          );
          entry.playbackSamples.push(activeSample);
          if (activeSample.done === true) break;
          if (Date.now() > deadline)
            throw new Error('Memory replay exceeded 180 seconds');
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        entry.sampledPeakElements = Math.max(
          ...entry.playbackSamples.map((value) => value.elements)
        );
        entry.sampledPeakPierreFadeWrappers = Math.max(
          ...entry.playbackSamples.map((value) => value.pierreFadeWrappers)
        );
        entry.sampledPeakStreamdownFadeWrappers = Math.max(
          ...entry.playbackSamples.map((value) => value.streamdownFadeWrappers)
        );
        entry.settled = JSON.parse(browser('eval', sampleScript));
        browser('eval', 'window.markdownComparison.reset();true');
        browser('wait', '--fn', 'window.markdownComparison?.ready === true');
        entry.reset = JSON.parse(browser('eval', sampleScript));
        entry.retainedHeapDelta =
          entry.settled!.heapUsed - entry.baseline!.heapUsed;
        entry.resetHeapDelta = entry.reset!.heapUsed - entry.baseline!.heapUsed;
      } catch (error) {
        entry.error = String(error);
        try {
          entry.failureState = JSON.parse(
            browser(
              'eval',
              '({url:location.href,ready:window.markdownComparison?.ready ?? null,result:window.markdownComparison?.result() ?? null})'
            )
          );
        } catch {}
        process.exitCode = 1;
      } finally {
        report.samples.push(entry);
        save();
        if (opened) {
          opened = false;
          browser('close');
        }
      }
    }
} finally {
  if (opened) browser('close');
}
console.log(JSON.stringify(report, null, 2));
