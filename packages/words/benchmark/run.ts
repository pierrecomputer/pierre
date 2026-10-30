import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  benchmarkDirectory,
  environmentMetadata,
  harnessDependencies,
} from './environment.ts';
import { writeReport } from './report.ts';
import type { BrowserReport, MemoryReport } from './types';

const args = process.argv.slice(2);
const mode = args.shift();
if (!mode || !['quick', 'full'].includes(mode))
  throw new Error(
    'Usage: run.ts quick|full [--output=path] [--scales=1,100] [--modes=plain,highlight,animated] [--runs=3] [--stress] [--skip-memory] [--phases=parser-static,parser,stream,footprint,browser,memory]'
  );
const options = Object.fromEntries(
  args.map((argument) => {
    if (!argument.startsWith('--'))
      throw new Error(`Expected --key=value: ${argument}`);
    const [key, ...value] = argument.slice(2).split('=');
    return [key, value.length !== 0 ? value.join('=') : true];
  })
);
for (const key of Object.keys(options))
  if (
    ![
      'output',
      'scales',
      'modes',
      'runs',
      'stress',
      'skip-memory',
      'phases',
    ].includes(key)
  )
    throw new Error(`Unknown option: --${key}`);
for (const key of ['stress', 'skip-memory'])
  if (options[key] !== undefined && options[key] !== true)
    throw new Error(`--${key} is a flag without a value`);
for (const key of ['output', 'scales', 'modes', 'runs', 'phases'])
  if (options[key] === true) throw new Error(`--${key} requires a value`);
const quick = mode === 'quick';
const scales = String(options.scales ?? (quick ? '1' : '1,100'));
const modes = String(
  options.modes ?? (quick ? 'plain,highlight' : 'plain,highlight,animated')
);
const runs = Number(options.runs ?? (quick ? 1 : 3));
const phases = String(
  options.phases ??
    (quick
      ? 'parser-static,parser,stream,footprint,browser'
      : 'parser-static,parser,stream,footprint,browser,memory')
)
  .split(',')
  .filter(
    (phase) =>
      phase !== 'memory' ||
      !(
        options['skip-memory'] != null &&
        options['skip-memory'] !== false &&
        options['skip-memory'] !== ''
      )
  );
if (
  phases.length === 0 ||
  new Set(phases).size !== phases.length ||
  phases.some(
    (phase) =>
      ![
        'parser-static',
        'parser',
        'stream',
        'footprint',
        'browser',
        'memory',
      ].includes(phase)
  )
)
  throw new Error(
    'Expected unique known --phases=parser-static,parser,stream,footprint,browser,memory'
  );
if (
  scales.split(',').some((value) => !['1', '100'].includes(value)) ||
  modes
    .split(',')
    .some((value) => !['plain', 'highlight', 'animated'].includes(value)) ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 3
)
  throw new Error(
    'Use --scales=1,100, --modes=plain,highlight,animated, and --runs=1..3. Capacity runs use --stress.'
  );
const stamp = new Date().toISOString().replaceAll(':', '-');
const output = resolve(
  String(
    options.output ?? join(benchmarkDirectory, 'output', `${stamp}-${mode}`)
  )
);
if (existsSync(join(output, 'manifest.json')))
  throw new Error(
    `Output already contains a run: ${output}. Choose a new directory to preserve prior evidence.`
  );
mkdirSync(output, { recursive: true });
const manifest: Record<string, unknown> & {
  status: string;
  phases: {
    name: string;
    command: string[];
    started: string;
    status: string;
  }[];
} = {
  schemaVersion: 1,
  mode,
  status: 'running',
  started: new Date().toISOString(),
  output,
  environment: environmentMetadata(),
  configuration: {
    scales,
    modes,
    runs,
    stress: Boolean(options.stress),
    phases,
    memory: phases.includes('memory'),
  },
  phases: [],
};
const save = () =>
  writeFileSync(
    join(output, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );

/** Run phases serially and retain stdout/stderr alongside machine-readable output. */
async function runPhase(
  name: string,
  file: string,
  arguments_: string[],
  { exposeGc = false } = {}
) {
  const command = [
    ...(exposeGc ? ['--expose-gc'] : []),
    join(benchmarkDirectory, file),
    ...arguments_,
  ];
  const entry = {
    name,
    command: [process.execPath, ...command],
    started: new Date().toISOString(),
    status: 'running',
  };
  manifest.phases.push(entry);
  save();
  console.log(`Words benchmark: ${name}`);
  let log = '';
  const child = spawn(process.execPath, command, {
    cwd: benchmarkDirectory,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk: string) => {
      log += chunk;
      process.stdout.write(chunk);
    });
  const status = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    error?: string;
  }>((resolve) => {
    child.on('error', (error) =>
      resolve({ code: null, signal: null, error: String(error) })
    );
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  writeFileSync(join(output, `${name}.log`), log);
  Object.assign(entry, {
    completed: new Date().toISOString(),
    status: status.code === 0 ? 'complete' : 'failed',
    ...status,
  });
  save();
  if (status.code !== 0)
    throw new Error(
      `${name} failed (${status.code ?? status.signal}); see ${name}.log`
    );
}

/** Reuse prepared bundles for heap sampling, then always release the local port. */
async function memoryPhase() {
  const child = spawn(
    process.execPath,
    [
      join(benchmarkDirectory, 'compare-browser-runner.ts'),
      `--output=${join(output, 'browser')}`,
      '--skip-build',
      '--serve-only',
    ],
    {
      cwd: benchmarkDirectory,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let line = '';
  let serverLog = '';
  child.stderr.on('data', (chunk: string) => {
    serverLog += chunk;
  });
  try {
    const baseUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Benchmark memory server startup timed out')),
        30000
      );
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Memory server exited (${code}): ${serverLog}`));
      });
      child.stdout.on('data', (chunk: string) => {
        line += chunk;
        serverLog += chunk;
        for (const value of line.split('\n')) {
          try {
            const ready = JSON.parse(value);
            if (Boolean(ready.ready) && Boolean(ready.baseUrl)) {
              clearTimeout(timeout);
              resolve(ready.baseUrl);
              return;
            }
          } catch {}
        }
      });
    });
    for (const memoryMode of modes.split(',')) {
      await runPhase(`memory-${memoryMode}`, 'memory.ts', [
        baseUrl,
        join(output, `memory-${memoryMode}.json`),
        memoryMode,
        '100',
        String(runs),
      ]);
      const report = JSON.parse(
        readFileSync(join(output, `memory-${memoryMode}.json`), 'utf8')
      );
      validateMemory(report, memoryMode);
    }
  } finally {
    writeFileSync(join(output, 'memory-server.log'), serverLog);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  }
}

/** Reject incomplete matrices, invalid values, and unmatched normalized output. */
function validateBrowser(directory: string) {
  const report = JSON.parse(
    readFileSync(join(directory, 'summary.json'), 'utf8')
  ) as BrowserReport;
  const expected =
    2 * scales.split(',').length * modes.split(',').length * runs;
  if (report.results.length !== expected)
    throw new Error(
      `Expected ${expected} browser samples; received ${report.results.length}`
    );
  const identities = new Set();
  for (const result of report.results) {
    const identity = `${result.library}/${result.mode}/${result.scale}/${result.run}`;
    if (identities.has(identity))
      throw new Error(`Duplicate browser sample: ${identity}`);
    identities.add(identity);
    if (
      !['pierre', 'streamdown'].includes(result.library) ||
      !modes.split(',').includes(result.mode) ||
      !scales.split(',').includes(String(result.scale)) ||
      !Number.isInteger(result.run) ||
      result.run < 0 ||
      result.run >= runs
    )
      throw new Error(`Unexpected browser sample: ${identity}`);
    if (
      result.error ||
      !result.done ||
      !Array.isArray(result.errors) ||
      Boolean(result.errors.length) ||
      result.pendingHighlights !== 0 ||
      result.retainedFadeSpans !== 0 ||
      result.committedUpdates !== result.expectedUpdates
    )
      throw new Error(
        `Invalid browser sample: ${identity}. See ${directory}/summary.json`
      );
    for (const key of [
      'commitP50',
      'commitP95',
      'frameP95',
      'elapsed',
      'settledElapsed',
      'expectedUpdates',
      'semanticCharacters',
      'paragraphs',
      'fences',
    ])
      if (
        typeof result[key] !== 'number' ||
        !Number.isFinite(result[key]) ||
        result[key] <= 0
      )
        throw new Error(`Invalid browser ${key}: ${identity}`);
    if (
      typeof result.semanticHash !== 'string' ||
      !/^[0-9a-f]+$/.test(result.semanticHash)
    )
      throw new Error(`Missing normalized content hash: ${identity}`);
    if (result.mode !== 'plain' && result.highlightedFences !== result.fences)
      throw new Error(`Unhighlighted fences: ${identity}`);
    const peer = report.results.find(
      (value) =>
        value.library !== result.library &&
        value.mode === result.mode &&
        value.scale === result.scale &&
        value.run === result.run
    );
    if (peer == null)
      throw new Error(`Missing paired renderer sample: ${identity}`);
    for (const key of [
      'paragraphs',
      'fences',
      'semanticCharacters',
      'semanticHash',
    ])
      if (result[key] !== peer[key])
        throw new Error(`Output parity failed for ${key}: ${identity}`);
  }
}

/** Heap evidence requires every fresh-browser stage to be settled and error-free. */
function validateMemory(report: MemoryReport, memoryMode: string) {
  if (report.samples.length !== 2 * runs)
    throw new Error(`Incomplete ${memoryMode} memory matrix`);
  const identities = new Set();
  for (const sample of report.samples) {
    const identity = `${sample.library}/${sample.run}`;
    if (
      identities.has(identity) ||
      !['pierre', 'streamdown'].includes(sample.library) ||
      !Number.isInteger(sample.run) ||
      sample.run < 0 ||
      sample.run >= runs ||
      sample.mode !== memoryMode ||
      sample.scale !== 100 ||
      Boolean(sample.error)
    )
      throw new Error(`Invalid memory sample: ${identity}`);
    identities.add(identity);
    for (const name of ['baseline', 'settled', 'reset'] as const) {
      const stage = sample[name];
      if (
        stage == null ||
        !Number.isFinite(stage.heapUsed) ||
        stage.heapUsed <= 0 ||
        !Array.isArray(stage.errors) ||
        Boolean(stage.errors.length) ||
        stage.pendingHighlights !== 0 ||
        stage.fadeSpans !== 0
      )
        throw new Error(`Invalid memory ${name}: ${identity}`);
    }
    if (
      sample.baseline.elements !== sample.reset.elements ||
      sample.baseline.textCharacters !== 0 ||
      sample.reset.textCharacters !== 0 ||
      sample.baseline.paragraphs !== 0 ||
      sample.reset.paragraphs !== 0 ||
      sample.baseline.fences !== 0 ||
      sample.reset.fences !== 0 ||
      sample.settled.paragraphs !== 10100 ||
      sample.settled.fences !== 100 ||
      !Number.isFinite(sample.retainedHeapDelta) ||
      !Number.isFinite(sample.resetHeapDelta)
    )
      throw new Error(`Invalid memory output/reset: ${identity}`);
  }
}

save();
try {
  manifest.environment = environmentMetadata({ browser: true });
  save();
  if (phases.includes('parser-static'))
    await runPhase('parser-static', 'bench.ts', [
      `--json=${join(output, 'parser-static.json')}`,
      ...(quick ? ['--budget=100'] : []),
    ]);
  if (phases.includes('parser'))
    await runPhase(
      'parser',
      'html.ts',
      [join(output, 'parser.json'), `--scales=${quick ? '1' : '1,100,1000'}`],
      { exposeGc: true }
    );
  if (phases.includes('stream'))
    await runPhase('stream', 'stream.ts', [
      `--json=${join(output, 'stream.json')}`,
    ]);
  if (phases.includes('footprint'))
    await runPhase('footprint', 'footprint.ts', [
      harnessDependencies,
      join(output, 'footprint'),
    ]);
  if (phases.includes('browser'))
    await runPhase('browser', 'compare-browser-runner.ts', [
      `--output=${join(output, 'browser')}`,
      `--scales=${scales}`,
      `--modes=${modes}`,
      `--runs=${runs}`,
      '--scroll=top',
      '--containment=none',
    ]);
  if (phases.includes('browser')) validateBrowser(join(output, 'browser'));
  if (phases.includes('memory')) {
    if (!phases.includes('browser'))
      await runPhase('prepare-browser', 'compare-browser-runner.ts', [
        `--output=${join(output, 'browser')}`,
        '--prepare-only',
      ]);
    await memoryPhase();
  }
  if (
    options.stress != null &&
    options.stress !== false &&
    options.stress !== ''
  ) {
    await runPhase('stress', 'compare-browser-runner.ts', [
      `--output=${join(output, 'stress')}`,
      '--scales=1000',
      '--modes=highlight,animated',
      '--runs=1',
      '--timeout=180000',
      '--scroll=top',
      '--containment=none',
    ]);
    // Stress includes bounded failures as capacity evidence; never aggregate partial rows.
  }
  manifest.status = 'complete';
} catch (error) {
  manifest.status = 'failed';
  manifest.error = String(error);
  process.exitCode = 1;
} finally {
  manifest.completed = new Date().toISOString();
  save();
  try {
    writeReport(output);
  } catch (error) {
    manifest.status = 'failed';
    manifest.error = String(error);
    process.exitCode = 1;
    save();
  }
  console.log(
    `Words benchmark ${manifest.status}: ${join(output, 'manifest.json')}`
  );
}
