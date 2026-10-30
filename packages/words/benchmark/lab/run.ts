#!/usr/bin/env node

import type { Comparison } from './statistics';
import type { measure } from './worker';

type WorkerResult = Awaited<ReturnType<typeof measure>>;
type ComparisonRow = Partial<Comparison> & {
  caseId: string;
  candidateMs: number;
  warnings: string[];
};

import { fork } from 'node:child_process';
import { cpSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { environmentMetadata, sha256 } from '../environment.ts';
import {
  capture,
  hashTree,
  loadCapture,
  newDirectory,
  packageDirectory,
  save,
} from './capture.ts';
import { listCases } from './cases.ts';
import {
  confirmationIssues,
  guardCaseIds,
  measurementProfiles,
  objectiveCaseIds,
  suiteCaseIds,
  suiteId,
} from './policy.ts';
import {
  aggregate,
  comparePairs,
  median,
  randomGenerator,
  shuffle,
} from './statistics.ts';

const directory = dirname(fileURLToPath(import.meta.url));
const commands = ['list', 'capture', 'quick', 'confirm', 'profile'];
const help = `Words optimization lab (Node; parser only, no browser/highlighter)
  moonx words:lab --ignore-ci-checks -- list
  moonx words:lab --ignore-ci-checks -- capture --output=/tmp/words-before
  moonx words:lab --ignore-ci-checks -- quick [--baseline=/tmp/words-before] [--candidate=/tmp/words-after]
  moonx words:lab --ignore-ci-checks -- confirm --baseline=/tmp/words-before [--candidate=/tmp/words-after]
  moonx words:lab --ignore-ci-checks -- profile --candidate=/tmp/words-after --case=CASE

quick/confirm: --cases=id,id|all --output=NEW_DIRECTORY --rounds=N --seed=N
               --warmup-ms=N --warmup-deliveries=N --warmup-operations=N --warmup-max-ms=N
               --sample-ms=N --samples=N --threshold=R --timeout-ms=N
profile:       --output=NEW_DIRECTORY --duration-ms=3000
Omitted candidate captures the current build. Capture directories never change.
Quick nominates candidates at a 3% per-case screening threshold; it never accepts
or reports intervals. Confirm uses 12 fresh pairs, longer warmup, a 2% practical
threshold, and family-adjusted bootstrap intervals. summary.json separates the
streaming objective score from regression guards and an explicit accepted flag.
Only valid full-suite confirmations meeting the fixed measurement minimums can
accept. Narrower or shortened runs are diagnostic. One operation is a complete
document or a replay including its final settled delivery.
`;

/** Workers run serially; each has a fresh VM, Wasm instance, and warmup. */
function runWorker(
  configuration: Parameters<typeof measure>[0],
  timeoutMs: number
) {
  return new Promise<WorkerResult>((resolve, reject) => {
    const child = fork(
      join(directory, 'worker.ts'),
      [JSON.stringify(configuration)],
      {
        execArgv: [],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, NODE_OPTIONS: '' },
      }
    );
    let message: { result?: WorkerResult; error?: string } | undefined;
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr!.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('message', (value) => {
      message = value as typeof message;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code: number, signal) => {
      clearTimeout(timeout);
      if (code !== 0 || message?.result == null)
        reject(
          new Error(
            message?.error ??
              `Worker failed (${code ?? signal}); deadline ${timeoutMs}ms\n${stderr}`
          )
        );
      else resolve(message.result);
    });
  });
}

const args = process.argv.slice(2);
const command = args.shift() ?? 'quick';
if (command === '--help' || args.includes('--help')) {
  console.log(help);
} else {
  if (!commands.includes(command)) throw new Error(help);
  const options: Record<string, string | undefined> = {};
  for (const argument of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (match == null || Object.hasOwn(options, match[1]))
      throw new Error(`Expected unique --key=value: ${argument}`);
    options[match[1]] = match[2];
  }
  const allowed =
    command === 'list'
      ? []
      : command === 'capture'
        ? ['output']
        : command === 'profile'
          ? ['output', 'candidate', 'case', 'duration-ms']
          : [
              'output',
              'baseline',
              'candidate',
              'cases',
              'rounds',
              'seed',
              'warmup-ms',
              'warmup-deliveries',
              'warmup-operations',
              'warmup-max-ms',
              'sample-ms',
              'samples',
              'threshold',
              'timeout-ms',
            ];
  for (const key of Object.keys(options))
    if (!allowed.includes(key))
      throw new Error(`Unknown ${command} option: --${key}`);
  const number = (
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
    integer = true
  ) => {
    const value = Number(options[key] ?? fallback);
    if (
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum ||
      (integer && !Number.isInteger(value))
    )
      throw new Error(
        `--${key} must be ${integer ? 'an integer' : 'a number'} in [${minimum}, ${maximum}]`
      );
    return value;
  };
  const output = resolve(
    options.output ??
      join(
        packageDirectory,
        'benchmark/output/lab',
        `${new Date().toISOString().replaceAll(':', '-')}-${command}`
      )
  );

  if (command === 'list') {
    for (const item of listCases())
      console.log(
        `${objectiveCaseIds.includes(item.id) ? 'O' : guardCaseIds.includes(item.id) ? 'G' : ' '} ${item.id}\t${item.inputBytes} bytes; ${item.updates} updates\t${item.description}`
      );
    console.log('O objective; G regression guard; both run by default');
  } else if (command === 'capture') {
    await capture(output);
    console.log(`Captured ${output}`);
  } else if (command === 'profile') {
    const caseId = options.case ?? objectiveCaseIds[0];
    if (!listCases().some((item) => item.id === caseId))
      throw new Error(`Unknown case: ${caseId}`);
    const durationMs = number('duration-ms', 3000, 100, 600000);
    const target = options.candidate ? loadCapture(options.candidate) : null;
    newDirectory(output);
    const profileTarget = join(output, 'target');
    if (target != null)
      cpSync(target.directory, profileTarget, { recursive: true });
    else await capture(profileTarget);
    const saved = loadCapture(profileTarget);
    if (
      saved.manifest.artifacts['scripts/build.ts'] !==
      sha256(join(packageDirectory, 'scripts/build.ts'))
    )
      throw new Error(
        'The captured WAT build helper differs from the current helper; profile from the matching source revision'
      );
    const { buildDiagnostic, profileCase } = await import('./profile.ts');
    await buildDiagnostic(profileTarget);
    const report = await profileCase({
      caseId,
      targetDirectory: profileTarget,
      outputDirectory: output,
      durationMs,
    });
    save(join(output, 'profile.json'), {
      ...report,
      capture: saved.manifest,
      environment: environmentMetadata(),
    });
    console.log(`Profile artifacts: ${output}`);
  } else {
    const confirm = command === 'confirm';
    if (confirm && !options.baseline)
      throw new Error(
        'confirm requires --baseline=<capture>; use quick for absolute measurements'
      );
    const caseIds =
      options.cases === 'all'
        ? listCases().map((item) => item.id)
        : (options.cases?.split(',') ?? suiteCaseIds);
    if (
      caseIds.length === 0 ||
      new Set(caseIds).size !== caseIds.length ||
      caseIds.some((id) => !listCases().some((item) => item.id === id))
    )
      throw new Error('Select unique case IDs from the list command');
    const profile = measurementProfiles[confirm ? 'confirm' : 'quick'];
    const configuration = {
      rounds: number(
        'rounds',
        confirm ? 12 : options.baseline ? 4 : 1,
        confirm ? 8 : 1,
        200
      ),
      seed: number('seed', 20261026, 0, 4294967295),
      warmupMs: number('warmup-ms', profile.warmupMs, 1, 60000),
      warmupDeliveries: number(
        'warmup-deliveries',
        profile.warmupDeliveries,
        0,
        10000000
      ),
      warmupOperations: number(
        'warmup-operations',
        profile.warmupOperations,
        0,
        10000000
      ),
      warmupMaxMs: number('warmup-max-ms', profile.warmupMaxMs, 1, 600000),
      sampleMs: number('sample-ms', profile.sampleMs, 1, 60000),
      samples: number('samples', profile.samples, 3, 1000),
      threshold: number('threshold', profile.threshold, 0, 0.99, false),
      timeoutMs: number('timeout-ms', 120000, 1000, 3600000),
      caseIds,
      warmupProfile: confirm ? 'long-confirmation' : 'quick-screen',
      // A candidate can win on any objective case; allocate the nominal error
      // budget across all measured cases instead of searching many 95% intervals.
      confidence: confirm ? 1 - 0.05 / caseIds.length : null,
    };
    if (confirm && Boolean(configuration.rounds % 2))
      throw new Error(
        'confirm requires an even number of rounds for balanced AB/BA ordering'
      );
    if (configuration.warmupMaxMs < configuration.warmupMs)
      throw new Error('--warmup-max-ms must be at least --warmup-ms');
    const baseline = options.baseline ? loadCapture(options.baseline) : null;
    const candidate = options.candidate ? loadCapture(options.candidate) : null;
    newDirectory(output);
    const targets: Record<string, ReturnType<typeof loadCapture>> = {
      ...(baseline != null ? { baseline } : {}),
      candidate: candidate ?? (await capture(join(output, 'candidate'))),
    };
    const report: Record<string, unknown> & {
      runs: (WorkerResult & {
        round: number;
        caseId: string;
        label: string;
        startedOrder: number;
      })[];
      comparisons: ComparisonRow[];
      summary?: ReturnType<typeof aggregate>;
    } = {
      format: 'words-optimization-run',
      schemaVersion: 2,
      mode: command,
      status: 'running',
      started: new Date().toISOString(),
      configuration,
      policy: { suiteId, objectiveCaseIds, guardCaseIds },
      environment: environmentMetadata(),
      driverHashes: hashTree(directory),
      targets,
      loadBefore: loadavg(),
      runs: [],
      comparisons: [],
      interpretation:
        'Warm throughput; per-process medians of batch means. Stream operation = whole replay. Confidence intervals resample fresh process pairs, not loop iterations. No cold-start/DOM/highlighting claim.',
    };
    const reportPath = join(output, 'report.json');
    save(reportPath, report);
    const random = randomGenerator(configuration.seed);
    const orders = new Map(
      caseIds.map((id) => [
        id,
        shuffle(
          Array.from({ length: configuration.rounds }, (_, i) => i % 2 === 0),
          random
        ),
      ])
    );
    const references = new Map<string, string>();
    try {
      for (let round = 0; round < configuration.rounds; round++) {
        for (const caseId of shuffle(caseIds, random)) {
          const labels =
            baseline != null
              ? orders.get(caseId)![round]
                ? ['baseline', 'candidate']
                : ['candidate', 'baseline']
              : ['candidate'];
          for (const label of labels) {
            const result = await runWorker(
              { caseId, target: targets[label].directory, ...configuration },
              configuration.timeoutMs
            );
            report.runs.push({
              round,
              caseId,
              label,
              startedOrder: report.runs.length,
              ...result,
            });
            save(reportPath, report);
            const identity = JSON.stringify({
              descriptor: result.descriptor,
              verification: result.verification.outputSha256,
            });
            if (references.has(caseId) && references.get(caseId) !== identity)
              throw new Error(
                `${caseId}: fixture, operation contract, or exact output differs across targets/repetitions`
              );
            references.set(caseId, identity);
            console.log(
              `${round + 1}/${configuration.rounds} ${label.padEnd(9)} ${caseId}: ${result.summary.medianMs.toFixed(4)} ms/op`
            );
          }
        }
      }
      if (
        JSON.stringify(hashTree(directory)) !==
        JSON.stringify(report.driverHashes)
      )
        throw new Error(
          'Benchmark driver changed during measurement; discard this run'
        );
      for (const target of Object.values(targets))
        loadCapture(target.directory);
      report.comparisons = caseIds.map((caseId, index: number) => {
        const runs = report.runs.filter((run) => run.caseId === caseId);
        const candidateMs = median(
          runs
            .filter((run) => run.label === 'candidate')
            .map((run) => run.summary.medianMs)
        );
        const warnings = [];
        if (runs.some((run) => run.summary.relativeMad > 0.1))
          warnings.push('Within-process MAD exceeds 10%; inspect raw samples');
        if (
          runs.some((run) => Math.abs((run.summary.lastVsFirst ?? 1) - 1) > 0.1)
        )
          warnings.push(
            'Within-process first/last half differs by >10%; increase warmup or remove machine interference'
          );
        if (runs.some((run) => !run.warmupReachedFloor))
          warnings.push(
            'Warmup cap prevented satisfying both the time and count floors'
          );
        if (baseline == null) return { caseId, candidateMs, warnings };
        const pairs = Array.from(
          { length: configuration.rounds },
          (_, round) => ({
            baseline: runs.find(
              (run) => run.round === round && run.label === 'baseline'
            )!.summary.medianMs,
            candidate: runs.find(
              (run) => run.round === round && run.label === 'candidate'
            )!.summary.medianMs,
          })
        );
        const comparison = comparePairs(pairs, {
          seed: configuration.seed + index,
          threshold: configuration.threshold,
          confirm,
          confidence: configuration.confidence ?? 0.95,
        });
        if (comparison.pairDispersion.relativeRange > 0.1)
          warnings.push(
            'Between-process pair ratios span >10%; repeat a fixed run under stable conditions'
          );
        return {
          caseId,
          baselineMs: median(pairs.map((pair) => pair.baseline)),
          candidateMs,
          warnings,
          ...comparison,
        };
      });
      report.status = 'complete';
      if (baseline != null) {
        report.summary = aggregate(report.comparisons as Comparison[], {
          threshold: configuration.threshold,
          confirm,
          objectiveCaseIds,
          requiredCaseIds: suiteCaseIds,
          qualificationIssues: confirm ? confirmationIssues(configuration) : [],
        });
        save(join(output, 'summary.json'), {
          format: 'words-optimization-summary',
          schemaVersion: 2,
          mode: command,
          baseline: baseline.directory,
          candidate: targets.candidate.directory,
          configuration,
          policy: report.policy,
          ...report.summary,
        });
      }
    } catch (error) {
      report.status = 'failed';
      report.error = error instanceof Error ? error.stack : String(error);
      throw error;
    } finally {
      report.completed = new Date().toISOString();
      report.loadAfter = loadavg();
      save(reportPath, report);
      console.log(`Raw results: ${reportPath}`);
    }
    for (const row of report.comparisons) {
      const interval =
        row.ratioInterval != null
          ? `; ${(row.confidence! * 100).toFixed(2)}% ratio [${row.ratioInterval.map((n: number) => n.toFixed(4)).join(', ')}]`
          : '';
      const label =
        baseline != null
          ? confirm
            ? row.verdict
            : report.summary!.cases[row.caseId].screen
          : '';
      console.log(
        `${row.caseId}: ${row.candidateMs.toFixed(4)} ms/op${baseline != null ? `; ${row.timeReductionPercent!.toFixed(2)}% less time${interval}; ${label}` : ''}`
      );
      for (const warning of row.warnings) console.log(`  WARNING: ${warning}`);
    }
    if (baseline != null) {
      const summary = report.summary!;
      const scoreText =
        summary.score === null
          ? 'No objective cases measured'
          : `objective score ${summary.score.toFixed(4)} (${summary.scoreReductionPercent!.toFixed(2)}% less time, ${summary.speedup!.toFixed(3)}x; ${summary.scoreCaseIds.length}/${objectiveCaseIds.length} objective cases)`;
      console.log(
        `${scoreText}; status ${summary.status}; accepted=${summary.accepted}${summary.regressions.length !== 0 ? `; regressions: ${summary.regressions.join(', ')}` : ''}`
      );
      for (const issue of summary.qualificationIssues)
        console.log(`  DIAGNOSTIC: ${issue}`);
      if (summary.missingCases.length !== 0)
        console.log(
          `  DIAGNOSTIC: missing suite cases: ${summary.missingCases.join(', ')}`
        );
      console.log(
        `Summary: ${join(output, 'summary.json')}. ${confirm ? 'Intervals use a family-adjusted nominal error budget; bootstrap coverage remains approximate.' : 'Screening estimates nominate experiments, not keep/revert decisions.'} Freeze the benchmark policy during a search and confirm selected winners in a fresh, longer-warmup run.`
      );
    }
  }
}
