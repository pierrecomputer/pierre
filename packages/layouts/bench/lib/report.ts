import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';

import type { BundleSize } from './bundle';
import { type CheckResult, evaluateChecks, type RecordSummary } from './checks';
import type { Sample } from './measure';
import type { ContentWeight } from './scenarios';

/** What one benchmark test writes: every kept sample of one scenario at one parameter set. */
export interface RawRecord {
  scenario: string;
  panes: number;
  content: ContentWeight;
  steps: number;
  browser: string;
  display: { refreshHz: number; deviceScaleFactor: number };
  samples: Sample[];
}

/** The committed report. Version the shape, so that a later chart can read every report. */
export interface Report {
  schema: 1;
  createdAt: string;
  commit: { sha: string; branch: string; dirty: boolean };
  environment: {
    browser: string;
    headless: boolean;
    refreshHz: number;
    deviceScaleFactor: number;
    os: string;
    cpu: string;
    cpuCount: number;
    memoryGb: number;
    viewport: { width: number; height: number };
    runs: number;
    warmupRuns: number;
    /** The fixture parameters that selected a variant, or an empty string. */
    variant: string;
  };
  records: {
    scenario: string;
    panes: number;
    content: ContentWeight;
    steps: number;
    median: Sample;
    samples: Record<keyof Sample, number[]>;
  }[];
  checks: CheckResult[];
  /** Bytes of each entry point: minified, then gzip, brotli, and Zstandard. */
  bundle: Record<string, BundleSize>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return Number(value.toFixed(3));
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function findRecords(directory: string): RawRecord[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('record.json'))
    .map(
      (path) =>
        JSON.parse(readFileSync(join(directory, path), 'utf8')) as RawRecord
    );
}

/** Merge the records of one run into a report, evaluate the baseline checks, and write it. */
export function writeReport(options: {
  recordsDirectory: string;
  resultsDirectory: string;
  headless: boolean;
  viewport: { width: number; height: number };
  runs: number;
  warmupRuns: number;
  bundle: Record<string, BundleSize>;
  variant: string;
}): { path: string; report: Report } | null {
  const raw = findRecords(options.recordsDirectory).sort((a, b) => {
    if (a.scenario !== b.scenario) return a.scenario.localeCompare(b.scenario);
    if (a.panes !== b.panes) return a.panes - b.panes;
    return a.content.localeCompare(b.content);
  });
  if (raw.length === 0) return null;

  const records = raw.map((record) => {
    const keys = Object.keys(record.samples[0]) as (keyof Sample)[];
    const samples = {} as Record<keyof Sample, number[]>;
    const middle = {} as Sample;
    for (const key of keys) {
      samples[key] = record.samples.map((sample) =>
        Number(sample[key].toFixed(3))
      );
      middle[key] = median(samples[key]);
    }
    return {
      scenario: record.scenario,
      panes: record.panes,
      content: record.content,
      steps: record.steps,
      median: middle,
      samples,
    };
  });
  const summaries: RecordSummary[] = records;

  const sha = git(['rev-parse', 'HEAD']);
  const report: Report = {
    schema: 1,
    createdAt: new Date().toISOString(),
    commit: {
      sha,
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      dirty: git(['status', '--porcelain', '--', '.']).length > 0,
    },
    environment: {
      browser: raw[0].browser,
      headless: options.headless,
      refreshHz: raw[0].display.refreshHz,
      deviceScaleFactor: raw[0].display.deviceScaleFactor,
      os: `${platform()} ${release()} ${arch()}`,
      cpu: cpus()[0]?.model ?? 'unknown',
      cpuCount: cpus().length,
      memoryGb: Math.round(totalmem() / 2 ** 30),
      viewport: options.viewport,
      runs: options.runs,
      warmupRuns: options.warmupRuns,
      variant: options.variant,
    },
    records,
    checks: evaluateChecks(summaries),
    bundle: options.bundle,
  };

  mkdirSync(options.resultsDirectory, { recursive: true });
  const date = report.createdAt.slice(0, 10);
  const variant = options.variant.replace(/[^a-z0-9]+/gi, '-');
  const suffix = `${variant === '' ? '' : `-${variant}`}${options.headless ? '' : '-headed'}${report.commit.dirty ? '-dirty' : ''}`;
  let name = `${date}-${sha.slice(0, 8)}${suffix}`;
  for (
    let index = 2;
    existsSync(join(options.resultsDirectory, `${name}.json`));
    index++
  ) {
    name = `${date}-${sha.slice(0, 8)}${suffix}-${index}`;
  }
  const path = join(options.resultsDirectory, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return { path, report };
}

/** Print the checks as a table, so that a reader sees the result without opening the report. */
export function formatChecks(checks: CheckResult[]): string {
  const rows = checks.map((check) => [
    check.pass === null ? 'n/a' : check.pass ? 'pass' : 'FAIL',
    check.rule,
    check.id,
    check.value === null ? '-' : String(check.value),
    check.limit,
  ]);
  const widths = [0, 1, 2, 3, 4].map((column) =>
    Math.max(...rows.map((row) => row[column].length))
  );
  return rows
    .map((row) =>
      row.map((cell, column) => cell.padEnd(widths[column])).join('  ')
    )
    .join('\n');
}
