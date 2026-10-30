import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createChartData } from './chart-data.ts';
import type { RecordedReport } from './types';

const bytes = readFileSync(
  new URL('./results/2026-10-23-current.json', import.meta.url)
);
const snapshot = JSON.parse(bytes.toString()) as RecordedReport;

void test('published chart values preserve unrounded samples and traceable raw evidence', () => {
  const chart = createChartData(bytes);
  const highlighted = chart.browser.rows.find(
    ({ scale, mode }) => scale === 100 && mode === 'highlight'
  );
  assert.ok(highlighted != null);
  assert.equal(highlighted.words.updateP95Milliseconds, 4.099999904632568);
  assert.equal(
    highlighted.streamdown.updateP95Milliseconds,
    21.600000143051147
  );
  assert.equal(
    chart.provenance.sourceSha256,
    createHash('sha256').update(bytes).digest('hex')
  );
  assert.equal(chart.provenance.uncommittedWorkingTree, true);
  assert.equal(chart.provenance.library.version, null);
  assert.equal(chart.browser.rows.length, 6);
  for (const path of highlighted.words.sourceRows) {
    const index = Number(/\[(\d+)\]/.exec(path)![1]);
    assert.equal(snapshot.browser.results[index].library, 'pierre');
    assert.equal(snapshot.browser.results[index].mode, 'highlight');
    assert.equal(snapshot.browser.results[index].scale, 100);
  }
});

void test('heap deltas are aggregated per sample instead of subtracting medians', () => {
  const modified = structuredClone(snapshot);
  const samples = modified.memory.highlight.samples.filter(
    ({ library }) => library === 'pierre'
  );
  for (const [index, sample] of samples.entries()) {
    sample.baseline.heapUsed = [100, 200, 300][index];
    sample.settled.heapUsed = [500, 210, 310][index];
    sample.reset.heapUsed = sample.baseline.heapUsed;
    sample.retainedHeapDelta =
      sample.settled.heapUsed - sample.baseline.heapUsed;
    sample.resetHeapDelta = 0;
  }
  const chart = createChartData(Buffer.from(JSON.stringify(modified)));
  assert.equal(chart.memory.rows[0].words.additionalHeapBytes, 10);
  assert.equal(
    chart.memory.rows[0].words.settledHeapBytes -
      chart.memory.rows[0].words.baselineHeapBytes,
    110
  );
});

void test('stress timeout remains missing timing data instead of a zero bar', () => {
  const animated = createChartData(bytes).stress.rows.find(
    ({ mode }) => mode === 'animated'
  );
  assert.equal(animated.streamdown.status, 'timed-out');
  assert.match(animated.streamdown.reason, /180000/);
  assert.equal(
    Object.hasOwn(animated.streamdown, 'updateP95Milliseconds'),
    false
  );
  assert.equal(animated.words.status, 'completed');
});

void test('configured footprint selects base initial load and highlighted loaded closure', () => {
  const chart = createChartData(bytes);
  assert.equal(chart.footprint.rows[0].streamdownGzipBytes, 158047);
  assert.equal(chart.footprint.rows[1].streamdownGzipBytes, 239413);
  assert.equal(chart.footprint.css.wordsGzipBytes, 1011);
});

void test('missing or failed samples cannot be promoted into chart evidence', () => {
  const missing = structuredClone(snapshot);
  missing.browser.results.pop();
  assert.throws(
    () => createChartData(Buffer.from(JSON.stringify(missing))),
    /Unexpected browser matrix rows/
  );
  const failed = structuredClone(snapshot);
  failed.browser.results[0].done = false;
  assert.throws(
    () => createChartData(Buffer.from(JSON.stringify(failed))),
    /Incomplete result/
  );
  const duplicate = structuredClone(snapshot);
  duplicate.memory.highlight.samples.find(
    ({ library, run }) => library === 'pierre' && run === 1
  )!.run = 0;
  assert.throws(
    () => createChartData(Buffer.from(JSON.stringify(duplicate))),
    /Duplicate or missing memory run IDs/
  );
});
