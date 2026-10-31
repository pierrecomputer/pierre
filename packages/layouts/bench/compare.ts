// Compare two benchmark reports: `moon run layouts:bench-compare -- <before.json> <after.json>`.
// Prints the checks that changed state, the metrics and the memory values that
// changed in each record, the repeat scenario, and the bundle sizes.
import { readFileSync } from 'node:fs';

import type { Report } from './lib/report';

// The metrics that the comparison prints, in this order.
const METRICS = [
  'mainThreadMs',
  'longestTaskMs',
  'scriptMs',
  'styleElements',
  'layouts',
  'layoutMs',
  'forcedLayouts',
  'paints',
  'framesDropped',
  'framesDroppedAfterFirst',
  'framesWithMainAnimation',
  'animationsNotComposited',
  'contentRenders',
  'contentResizeCallbacks',
] as const;

type Metric = (typeof METRICS)[number];
type ReportRecord = Report['records'][number];

// The memory values that the comparison prints, from the memory run of each record.
const MEMORY_VALUES = [
  'tileMemoryMb',
  'tileMemoryUnusedMb',
  'gpuMb',
  'rendererMb',
  'jsHeapMb',
  'domNodes',
  'layers',
] as const;

function load(path: string): Report {
  return JSON.parse(readFileSync(path, 'utf8')) as Report;
}

function value(record: ReportRecord, metric: Metric): number | undefined {
  if (metric === 'scriptMs') return record.median.cdpScriptMs;
  return (record.median as unknown as { [key: string]: number })[metric];
}

function format(number: number): string {
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function change(before: number, after: number): string {
  if (before === 0) return after === 0 ? '' : ' (new)';
  const percent = ((after - before) / before) * 100;
  return ` (${percent > 0 ? '+' : ''}${percent.toFixed(0)}%)`;
}

// A change of at least 1 and at least 10%.
function significant(before: number, after: number): boolean {
  return (
    Math.abs(after - before) >= 1 &&
    Math.abs(after - before) >= Math.abs(before) * 0.1
  );
}

function sameRecord(
  report: Report,
  record: ReportRecord
): ReportRecord | undefined {
  return report.records.find(
    (item) =>
      item.scenario === record.scenario &&
      item.panes === record.panes &&
      item.content === record.content
  );
}

const [beforePath, afterPath] = process.argv.slice(2);
if (beforePath === undefined || afterPath === undefined) {
  console.error('Usage: compare.ts <before.json> <after.json>');
  process.exit(2);
}
const before = load(beforePath);
const after = load(afterPath);
console.log(
  `before ${before.commit.sha.slice(0, 8)} (${before.environment.headless ? 'headless' : 'headed'}, ${before.environment.refreshHz ?? '?'} Hz)`
);
console.log(
  `after  ${after.commit.sha.slice(0, 8)} (${after.environment.headless ? 'headless' : 'headed'}, ${after.environment.refreshHz ?? '?'} Hz)\n`
);

console.log('Checks that changed state:');
for (const check of after.checks) {
  const old = before.checks.find((item) => item.id === check.id);
  if (old === undefined || old.pass === check.pass) continue;
  const state = (pass: boolean | null): string =>
    pass === null ? 'n/a' : pass ? 'pass' : 'FAIL';
  console.log(
    `  ${check.id}: ${state(old.pass)} ${old.value ?? '-'} -> ${state(check.pass)} ${check.value ?? '-'}`
  );
}
const passing = (report: Report): number =>
  report.checks.filter((check) => check.pass === true).length;
console.log(
  `  checks that pass: ${passing(before)} -> ${passing(after)} of ${after.checks.length}\n`
);

console.log('Metrics that changed by 10% or more (medians):');
for (const record of after.records) {
  const old = sameRecord(before, record);
  if (old === undefined) continue;
  const changes: string[] = [];
  for (const metric of METRICS) {
    const a = value(old, metric);
    const b = value(record, metric);
    if (a === undefined || b === undefined) continue;
    if (significant(a, b))
      changes.push(`${metric} ${format(a)} -> ${format(b)}${change(a, b)}`);
  }
  if (changes.length > 0)
    console.log(
      `  ${record.scenario} · ${record.panes} panes · ${record.content}\n    ${changes.join('\n    ')}`
    );
}

console.log('\nMemory that changed by 10% or more (memory run):');
for (const record of after.records) {
  const old = sameRecord(before, record)?.memory;
  if (old === undefined || record.memory === undefined) continue;
  const changes: string[] = [];
  for (const name of MEMORY_VALUES) {
    const a = old[name];
    const b = record.memory[name];
    if (significant(a, b))
      changes.push(`${name} ${format(a)} -> ${format(b)}${change(a, b)}`);
  }
  if (changes.length > 0)
    console.log(
      `  ${record.scenario} · ${record.panes} panes · ${record.content}\n    ${changes.join('\n    ')}`
    );
}

if (after.repeats !== undefined) {
  console.log('\nRepeat scenario (growth, then tile memory of covered panes):');
  for (const repeat of after.repeats) {
    const old = before.repeats?.find(
      (item) => item.panes === repeat.panes && item.content === repeat.content
    );
    const pair = (a: number | undefined, b: number): string =>
      a === undefined ? format(b) : `${format(a)} -> ${format(b)}`;
    const growth = Object.entries(repeat.growth)
      .map(
        ([name, b]) =>
          `${name} ${pair(old?.growth[name as keyof typeof repeat.growth], b)}`
      )
      .join(', ');
    console.log(
      `  ${repeat.panes} panes · ${repeat.content}: ${growth}; covered ${pair(old?.covered.tileMemoryMb, repeat.covered.tileMemoryMb)} MB`
    );
  }
}

if (before.bundle !== undefined && after.bundle !== undefined) {
  console.log('\nBundle sizes in bytes (minified / brotli / zstd):');
  for (const [entry, size] of Object.entries(after.bundle)) {
    const old = before.bundle[entry];
    const pair = (a: number | undefined, b: number): string =>
      a === undefined ? `${b}` : `${a} -> ${b}`;
    console.log(
      `  ${entry}: ${pair(old?.minified, size.minified)} / ${pair(old?.brotli, size.brotli)} / ${pair(old?.zstd, size.zstd)}`
    );
  }
}
