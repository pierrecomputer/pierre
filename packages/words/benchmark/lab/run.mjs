#!/usr/bin/env node

import { fork } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { environmentMetadata, sha256 } from '../environment.mjs';
import { defaultCaseIds, listCases } from './cases.mjs';
import {
  comparePairs,
  median,
  randomGenerator,
  shuffle,
} from './statistics.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(directory, '../..');
const commands = ['list', 'capture', 'quick', 'confirm', 'profile'];
const help = `Words optimization lab (Node; parser only, no browser/highlighter)
  moonx words:lab --ignore-ci-checks -- list
  moonx words:lab --ignore-ci-checks -- capture --output=/tmp/words-before
  moonx words:lab --ignore-ci-checks -- quick [--baseline=/tmp/words-before] [--candidate=/tmp/words-after]
  moonx words:lab --ignore-ci-checks -- confirm --baseline=/tmp/words-before [--candidate=/tmp/words-after]
  moonx words:lab --ignore-ci-checks -- profile --candidate=/tmp/words-after --case=CASE

quick/confirm: --cases=id,id|all --output=NEW_DIRECTORY --rounds=N --seed=N
               --warmup-ms=N --sample-ms=N --samples=N --threshold=0.02 --timeout-ms=N
profile:       --output=NEW_DIRECTORY --duration-ms=3000
Omitted candidate captures the current build. Capture directories never change.
Quick is exploratory; confirm defaults to 12 fresh process pairs and a 2% threshold.
One operation is a whole document or whole replay, not one stream delivery.
`;

/** Preserve partial runs without risking truncated JSON after interruption. */
function save(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
}

function newDirectory(path) {
  if (existsSync(path))
    throw new Error(`Output already exists: ${path}; choose a new directory`);
  mkdirSync(path, { recursive: true });
  return path;
}

function hashTree(path) {
  const files = {};
  const visit = (relative) => {
    for (const entry of readdirSync(join(path, relative), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) files[name] = sha256(join(path, name));
    }
  };
  visit('');
  return files;
}

/** Freeze the core module, its source, and identity without modifying dist. */
function capture(output) {
  newDirectory(output);
  for (const name of ['index.mjs', 'md.wasm'])
    cpSync(join(packageDirectory, 'dist', name), join(output, name));
  cpSync(join(packageDirectory, 'src'), join(output, 'src'), {
    recursive: true,
  });
  mkdirSync(join(output, 'scripts'));
  cpSync(
    join(packageDirectory, 'scripts/build.mjs'),
    join(output, 'scripts/build.mjs')
  );
  const manifest = {
    format: 'words-lab-capture',
    schemaVersion: 1,
    created: new Date().toISOString(),
    artifacts: hashTree(output),
    environment: environmentMetadata(),
  };
  save(join(output, 'capture.json'), manifest);
  return { directory: output, manifest };
}

function loadCapture(path) {
  const directory = resolve(path);
  const manifest = JSON.parse(
    readFileSync(join(directory, 'capture.json'), 'utf8')
  );
  if (manifest.format !== 'words-lab-capture' || manifest.schemaVersion !== 1)
    throw new Error(`Not a words lab capture: ${directory}`);
  for (const [name, hash] of Object.entries(manifest.artifacts))
    if (sha256(join(directory, name)) !== hash)
      throw new Error(`Capture changed: ${join(directory, name)}`);
  for (const name of [
    'index.mjs',
    'md.wasm',
    'src/md.wat',
    'scripts/build.mjs',
  ])
    if (!manifest.artifacts[name]) throw new Error(`Capture missing ${name}`);
  return { directory, manifest };
}

/** Workers run serially; each has a fresh VM, Wasm instance, and warmup. */
function runWorker(configuration, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = fork(
      join(directory, 'worker.mjs'),
      [JSON.stringify(configuration)],
      {
        execArgv: [],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, NODE_OPTIONS: '' },
      }
    );
    let message;
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('message', (value) => {
      message = value;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0 || !message?.result)
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
  const options = {};
  for (const argument of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match || Object.hasOwn(options, match[1]))
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
              'sample-ms',
              'samples',
              'threshold',
              'timeout-ms',
            ];
  for (const key of Object.keys(options))
    if (!allowed.includes(key))
      throw new Error(`Unknown ${command} option: --${key}`);
  const number = (key, fallback, minimum, maximum, integer = true) => {
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
        `${defaultCaseIds.includes(item.id) ? '*' : ' '} ${item.id}\t${item.inputBytes} bytes; ${item.updates} updates\t${item.description}`
      );
    console.log('* default quick/confirm selection');
  } else if (command === 'capture') {
    capture(output);
    console.log(`Captured ${output}`);
  } else if (command === 'profile') {
    const caseId = options.case ?? defaultCaseIds[0];
    if (!listCases().some((item) => item.id === caseId))
      throw new Error(`Unknown case: ${caseId}`);
    const durationMs = number('duration-ms', 3000, 100, 600000);
    const target = options.candidate ? loadCapture(options.candidate) : null;
    newDirectory(output);
    const profileTarget = join(output, 'target');
    if (target) cpSync(target.directory, profileTarget, { recursive: true });
    else capture(profileTarget);
    const saved = loadCapture(profileTarget);
    if (
      saved.manifest.artifacts['scripts/build.mjs'] !==
      sha256(join(packageDirectory, 'scripts/build.mjs'))
    )
      throw new Error(
        'The captured WAT build helper differs from the current helper; profile from the matching source revision'
      );
    const { buildDiagnostic, profileCase } = await import('./profile.mjs');
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
        : (options.cases?.split(',') ?? defaultCaseIds);
    if (
      !caseIds.length ||
      new Set(caseIds).size !== caseIds.length ||
      caseIds.some((id) => !listCases().some((item) => item.id === id))
    )
      throw new Error('Select unique case IDs from the list command');
    const configuration = {
      rounds: number(
        'rounds',
        confirm ? 12 : options.baseline ? 4 : 1,
        confirm ? 8 : 1,
        200
      ),
      seed: number('seed', 20261026, 0, 4294967295),
      warmupMs: number('warmup-ms', confirm ? 300 : 75, 1, 60000),
      sampleMs: number('sample-ms', confirm ? 30 : 15, 1, 60000),
      samples: number('samples', confirm ? 9 : 5, 3, 1000),
      threshold: number('threshold', 0.02, 0, 0.99, false),
      timeoutMs: number('timeout-ms', 120000, 1000, 3600000),
      caseIds,
    };
    if (confirm && configuration.rounds % 2)
      throw new Error(
        'confirm requires an even number of rounds for balanced AB/BA ordering'
      );
    const baseline = options.baseline ? loadCapture(options.baseline) : null;
    const candidate = options.candidate ? loadCapture(options.candidate) : null;
    newDirectory(output);
    const targets = {
      ...(baseline ? { baseline } : {}),
      candidate: candidate ?? capture(join(output, 'candidate')),
    };
    const report = {
      format: 'words-optimization-run',
      schemaVersion: 1,
      mode: command,
      status: 'running',
      started: new Date().toISOString(),
      configuration,
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
    const references = new Map();
    try {
      for (let round = 0; round < configuration.rounds; round++) {
        for (const caseId of shuffle(caseIds, random)) {
          const labels = baseline
            ? orders.get(caseId)[round]
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
      report.comparisons = caseIds.map((caseId, index) => {
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
        if (!baseline) return { caseId, candidateMs, warnings };
        const pairs = Array.from(
          { length: configuration.rounds },
          (_, round) => ({
            baseline: runs.find(
              (run) => run.round === round && run.label === 'baseline'
            ).summary.medianMs,
            candidate: runs.find(
              (run) => run.round === round && run.label === 'candidate'
            ).summary.medianMs,
          })
        );
        return {
          caseId,
          baselineMs: median(pairs.map((pair) => pair.baseline)),
          candidateMs,
          warnings,
          ...comparePairs(pairs, {
            seed: configuration.seed + index,
            threshold: configuration.threshold,
            confirm,
          }),
        };
      });
      report.status = 'complete';
    } catch (error) {
      report.status = 'failed';
      report.error = error.stack ?? String(error);
      throw error;
    } finally {
      report.completed = new Date().toISOString();
      report.loadAfter = loadavg();
      save(reportPath, report);
      console.log(`Raw results: ${reportPath}`);
    }
    for (const row of report.comparisons) {
      const interval = row.ratio95
        ? `; 95% ratio [${row.ratio95.map((n) => n.toFixed(4)).join(', ')}]`
        : '';
      console.log(
        `${row.caseId}: ${row.candidateMs.toFixed(4)} ms/op${baseline ? `; ${row.timeReductionPercent.toFixed(2)}% less time${interval}; ${row.verdict}` : ''}`
      );
      for (const warning of row.warnings) console.log(`  WARNING: ${warning}`);
    }
    if (baseline)
      console.log(
        'Per-case intervals are not simultaneous. Repeated candidate selection biases wins; confirm a selected winner in a new run on an idle machine.'
      );
  }
}
