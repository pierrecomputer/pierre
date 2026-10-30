import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  browserArguments,
  browserCommand,
  environmentMetadata,
  harnessDependencies,
} from './environment.ts';

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    if (!argument.startsWith('--'))
      throw new Error(`Expected --key=value: ${argument}`);
    const [key, ...value] = argument.slice(2).split('=');
    return [key, value.length !== 0 ? value.join('=') : true];
  })
);
const allowed = new Set([
  'deps',
  'output',
  'renderer-dir',
  'lines',
  'numbers',
  'runs',
  'node-runs',
  'memory-runs',
  'delay',
  'timeout',
  'phases',
  'diagnostics',
  'prepare-only',
  'skip-build',
  'serve-only',
]);
for (const key of Object.keys(options))
  if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
const directory = dirname(fileURLToPath(import.meta.url));
const repo = resolve(directory, '../../..');
const deps = resolve(String(options.deps ?? harnessDependencies));
const require = createRequire(join(deps, '../package.json'));
const output = resolve(String(options.output ?? '/tmp/words-fence-benchmark'));
const renderer = resolve(
  String(options['renderer-dir'] ?? join(directory, '../dist'))
);
const lines = String(options.lines ?? '1000,10000')
  .split(',')
  .map(Number);
const numbers = String(options.numbers ?? 'true,false')
  .split(',')
  .map((value) => {
    if (!['true', 'false'].includes(value))
      throw new Error('--numbers must be true or false');
    return value === 'true';
  });
const phases = String(options.phases ?? 'node,browser').split(',');
const runs = Number(options.runs ?? 3);
const nodeRuns = Number(options['node-runs'] ?? 5);
const memoryRuns = Number(options['memory-runs'] ?? 3);
const delay = Number(options.delay ?? 0);
const timeout = Number(options.timeout ?? 180000);
const diagnostics = options.diagnostics !== 'false';
if (
  lines.some(
    (count) => !Number.isInteger(count) || count < 8 || count > 100000
  ) ||
  phases.some((phase) => !['node', 'browser', 'memory'].includes(phase)) ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 10 ||
  !Number.isInteger(nodeRuns) ||
  nodeRuns < 1 ||
  nodeRuns > 10 ||
  !Number.isInteger(memoryRuns) ||
  memoryRuns < 1 ||
  memoryRuns > 10 ||
  !Number.isFinite(delay) ||
  delay < 0 ||
  delay > 1000 ||
  !Number.isFinite(timeout) ||
  timeout < 1000 ||
  timeout > 600000
)
  throw new RangeError(
    'Invalid lines/phases/runs/node-runs/memory-runs/delay/timeout'
  );
mkdirSync(output, { recursive: true });

/** Freeze standalone Node and browser production bundles before library changes. */
async function build() {
  const { build: bundle } = require('esbuild');
  // Saved pre-rename distributions still import the old core package internally.
  const savedLegacyRenderer =
    options['renderer-dir'] !== undefined &&
    readdirSync(renderer).some(
      (name: string) =>
        /\.m?js$/.test(name) &&
        /['"]@pierre\/markdowns['"]/.test(
          readFileSync(join(renderer, name), 'utf8')
        )
    );
  const common = {
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: [deps],
    alias: {
      react: join(deps, 'react'),
      'react-dom': join(deps, 'react-dom'),
      '@pierre/words/react': join(renderer, 'react.js'),
      '@pierre/words/highlights': join(renderer, 'highlights.js'),
      '@pierre/words/html': join(renderer, 'html.js'),
      '@pierre/words': join(renderer, 'index.js'),
      ...(savedLegacyRenderer
        ? {
            '@pierre/markdowns': join(renderer, 'index.js'),
          }
        : {}),
      '@pierre/highlights/themes/pierre-light': join(
        repo,
        'packages/highlights/dist/themes/pierre-light.js'
      ),
      '@pierre/highlights/themes/pierre-dark': join(
        repo,
        'packages/highlights/dist/themes/pierre-dark.js'
      ),
      '@pierre/highlights': join(repo, 'packages/highlights/dist/default.js'),
    },
  };
  await bundle({
    ...common,
    entryPoints: [join(directory, 'fence-browser.ts')],
    outfile: join(output, 'app.js'),
    platform: 'browser',
  });
  await bundle({
    ...common,
    entryPoints: [join(directory, 'fence-node.ts')],
    outfile: join(output, 'node.mjs'),
    platform: 'node',
  });
  writeFileSync(
    join(output, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Long code fence benchmark</title><link rel="stylesheet" href="./app.css"></head><body><main><div id="preview"></div></main><script type="module" src="./app.js"></script></body></html>\n'
  );
}
if (
  !(
    options['skip-build'] != null &&
    options['skip-build'] !== false &&
    options['skip-build'] !== ''
  )
)
  await build();
const hashes = Object.fromEntries(
  ['app.js', 'app.css', 'node.mjs'].map((name) => [
    name,
    createHash('sha256')
      .update(readFileSync(join(output, name)))
      .digest('hex'),
  ])
);
const metadata = {
  environment: environmentMetadata(),
  date: new Date().toISOString(),
  runtime: process.version,
  platform: `${process.platform}/${process.arch}`,
  rendererDirectory: renderer,
  react: JSON.parse(readFileSync(join(deps, 'react/package.json'), 'utf8'))
    .version,
  production: true,
  minified: true,
  animation: false,
  viewport: { width: 1280, height: 960 },
  lines,
  numbers,
  runs,
  nodeRuns,
  ...(phases.includes('memory') ? { memoryRuns } : {}),
  delay,
  hashes,
  notes: [
    'One growing TypeScript fence, about 250 deliveries, alternating complete and partial final lines; final delivery closes the fence.',
    'Node formatter timing requests complete pending HTML and reads its length, even when the DOM can use a suffix. The JavaScript engine may defer copying concatenated strings.',
    'Node runs include one discarded replay and a different-code grammar warmup. Exact code text and gutter parity plus normalized visible-text styling and HTML structure are checked after each timed replay; harmless span coalescing, trailing CSS semicolons, and line-break color differences are normalized.',
    'Browser update time covers flushSync React commit and native DOM patch; later layout and paint are represented by frame intervals and long tasks.',
    'Delay 0 uses separate MessageChannel tasks; positive delay is commit-paced setTimeout, not fixed-rate delivery.',
    'Diagnostic runs alone wrap template.innerHTML and collect mutations; their timings are excluded from primary samples.',
    'No viewport containment, virtualization, scrolling, or animation. Full code height remains in normal document layout.',
    'Separate initial bundles can be retained and rerun with --skip-build. Hashes identify the actual frozen code.',
  ],
};
writeFileSync(
  join(output, 'metadata.json'),
  JSON.stringify(metadata, null, 2) + '\n'
);
if (
  options['prepare-only'] != null &&
  options['prepare-only'] !== false &&
  options['prepare-only'] !== ''
) {
  console.log(
    JSON.stringify({
      ready: true,
      output,
      metadata: join(output, 'metadata.json'),
      hashes,
    })
  );
  process.exit(0);
}

const results = {
  metadata,
  node: [] as Record<string, unknown>[],
  browser: [] as Record<string, unknown>[],
  ...(phases.includes('memory')
    ? { memory: [] as Record<string, unknown>[] }
    : {}),
};
const save = () =>
  writeFileSync(
    join(output, 'summary.json'),
    JSON.stringify(results, null, 2) + '\n'
  );
save();
if (phases.includes('node')) {
  const { runNodeFence } = await import(
    pathToFileURL(join(output, 'node.mjs')).href
  );
  for (const lineCount of lines)
    for (const lineNumbers of numbers) {
      const result = runNodeFence(lineCount, lineNumbers, nodeRuns);
      results.node.push(result);
      save();
      console.log(JSON.stringify({ phase: 'node', ...result }));
    }
}
if (phases.includes('memory')) {
  const { runFenceMemory } = await import(
    pathToFileURL(join(output, 'node.mjs')).href
  );
  for (const lineCount of lines)
    for (const lineNumbers of numbers) {
      const result = await runFenceMemory(lineCount, lineNumbers, memoryRuns);
      results.memory!.push(result);
      save();
      console.log(JSON.stringify({ phase: 'memory', ...result }));
    }
}
if (!phases.includes('browser')) process.exit(0);

const server = createServer((request, response) => {
  const path = resolve(
    output,
    '.' + new URL(request.url!, 'http://localhost').pathname
  );
  if (
    !path.startsWith(output + sep) ||
    !existsSync(path) ||
    !statSync(path).isFile()
  ) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.setHeader(
    'Content-Type',
    path.endsWith('.js')
      ? 'text/javascript'
      : path.endsWith('.css')
        ? 'text/css'
        : 'text/html'
  );
  response.end(readFileSync(path));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
console.log(JSON.stringify({ ready: true, baseUrl, output }));
if (
  options['serve-only'] != null &&
  options['serve-only'] !== false &&
  options['serve-only'] !== ''
)
  await new Promise(() => {});

const execute = promisify(execFile);
let session: string;
let opened = false;
const browser = async (...arguments_: string[]) =>
  (
    await execute(browserCommand(), browserArguments(session, arguments_), {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30000,
    })
  ).stdout;
const close = async () => {
  if (!opened) return;
  opened = false;
  await browser('close');
};
try {
  for (const lineCount of lines)
    for (const lineNumbers of numbers) {
      const passes = Array.from({ length: runs }, (_, run) => ({
        run,
        diagnostic: false,
      }));
      if (diagnostics) passes.push({ run: 0, diagnostic: true });
      for (const pass of passes) {
        session = `words-fence-${process.pid}-${lineCount}-${lineNumbers}-${pass.diagnostic ? 'work' : pass.run}`;
        const settings = { lineCount, lineNumbers, ...pass };
        try {
          await browser(
            'open',
            `${baseUrl}/index.html?lines=${lineCount}&numbers=${lineNumbers}&diagnostic=${pass.diagnostic}&delay=${delay}`
          );
          opened = true;
          await browser('set', 'viewport', '1280', '960');
          await browser(
            'wait',
            '--fn',
            'window.markdownFence?.ready === true || window.markdownFence?.error != null'
          );
          await browser('eval', 'window.markdownFence.start();true');
          const deadline = Date.now() + timeout;
          while (
            !(
              JSON.parse(
                await browser('eval', 'window.markdownFence?.done === true')
              ) === true
            )
          ) {
            if (Date.now() > deadline)
              throw new Error(`Playback exceeded ${timeout} ms`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          const result = JSON.parse(
            await browser('eval', 'window.markdownFence.result()')
          );
          if (
            result.finalCodeParity !== true ||
            result.finalLineNumberParity !== true ||
            result.errors.length > 0 ||
            result.committedUpdates !== result.expectedUpdates ||
            result.retainedFadeSpans !== 0
          )
            throw new Error(
              `Playback correctness check failed: ${JSON.stringify(result)}`
            );
          results.browser.push({ ...settings, ...result });
        } catch (error) {
          let partial = null;
          try {
            partial = JSON.parse(
              await browser('eval', 'window.markdownFence?.result() ?? null')
            );
          } catch {
            /* A renderer crash remains a bounded recorded failure. */
          }
          results.browser.push({ ...settings, error: String(error), partial });
        } finally {
          save();
          console.log(
            JSON.stringify({ phase: 'browser', ...results.browser.at(-1) })
          );
          await close();
        }
      }
    }
} finally {
  await close();
  await new Promise((resolve) => server.close(resolve));
}
