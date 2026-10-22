import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Streamdown is deliberately isolated from the workspace dependency graph.
const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    if (!argument.startsWith('--'))
      throw new Error(`Expected --key=value: ${argument}`);
    const [key, ...value] = argument.slice(2).split('=');
    return [key, value.length ? value.join('=') : true];
  })
);
const allowed = new Set([
  'deps',
  'output',
  'libraries',
  'scales',
  'modes',
  'runs',
  'timeout',
  'prepare-only',
  'serve-only',
  'skip-build',
  'url',
]);
for (const key of Object.keys(options))
  if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
if (!options.deps) throw new Error('--deps must name isolated node_modules');
const deps = resolve(String(options.deps));
const output = resolve(
  String(options.output ?? '/tmp/markdowns-browser-comparison')
);
const require = createRequire(join(deps, '../package.json'));
const directory = dirname(fileURLToPath(import.meta.url));
const repo = resolve(directory, '../../..');
const libraries = String(options.libraries ?? 'pierre,streamdown').split(',');
const modes = String(options.modes ?? 'plain,highlight,animated').split(',');
const scales = String(options.scales ?? '1,100')
  .split(',')
  .map(Number);
const runs = Number(options.runs ?? 3);
const timeout = Number(options.timeout ?? 180000);
if (
  libraries.some((library) => !['pierre', 'streamdown'].includes(library)) ||
  modes.some((mode) => !['plain', 'highlight', 'animated'].includes(mode)) ||
  scales.some((scale) => ![1, 100, 1000].includes(scale)) ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 10 ||
  !Number.isFinite(timeout) ||
  timeout < 1000 ||
  timeout > 600000
)
  throw new RangeError('Invalid libraries/modes/scales/runs/timeout');
mkdirSync(output, { recursive: true });

const adapters = {
  pierre: `
import { createElement } from 'react';
import { Markdown } from '@pierre/markdowns/react';
import { createHighlightsPlugin } from '@pierre/markdowns/highlights';
import light from '@pierre/highlights/themes/pierre-light';
import dark from '@pierre/highlights/themes/pierre-dark';
const code=createHighlightsPlugin({themes:{light,dark},defaultColor:'light-dark()'});
const plugins={code};
const animation={animation:'fadeIn',duration:180};
export const pendingHighlights=()=>0;
export const warmup=async enabled=>{if(enabled)code.highlight({code:'const warmup: number = 1;\\n',language:'typescript',isIncomplete:false});};
export function Renderer({value,active,highlight,animated}){
 return createElement(Markdown,{mode:'streaming',isAnimating:active,animated:animated?animation:false,plugins:highlight?plugins:undefined,controls:false,lineNumbers:false},value);
}
`,
  streamdown: `
import { createElement } from 'react';
import { Streamdown } from 'streamdown';
import { code as nativeCode } from '@streamdown/code';
import 'streamdown/styles.css';
let pending=0;
const code={...nativeCode,highlight(options,callback){
 pending++;
 const result=nativeCode.highlight(options,value=>{pending--;callback?.(value);});
 if(result!==null)pending--;
 return result;
}};
const plugins={code};
const animation={animation:'fadeIn',duration:180,easing:'ease-out',sep:'word',stagger:0};
export const pendingHighlights=()=>pending;
export const warmup=async enabled=>{if(enabled)await new Promise(resolve=>{const result=nativeCode.highlight({code:'const warmup: number = 1;\\n',language:'typescript',themes:nativeCode.getThemes(),isIncomplete:false},resolve);if(result)resolve(result);});};
export function Renderer({value,active,highlight,animated}){
 return createElement(Streamdown,{mode:'streaming',dir:'ltr',isAnimating:active,animated:animated?animation:false,plugins:highlight?plugins:undefined,controls:false,lineNumbers:false,codeBlockMaxHeight:0},value);
}
`,
};

/** Build separate production entry points while forcing the exact same React. */
async function build() {
  const { build: bundle } = require('esbuild');
  for (const library of ['pierre', 'streamdown']) {
    const destination = join(output, library);
    mkdirSync(destination, { recursive: true });
    await bundle({
      entryPoints: [join(directory, 'compare-browser.ts')],
      outdir: destination,
      entryNames: 'app',
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      minify: true,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      nodePaths: [deps],
      alias: {
        react: join(deps, 'react'),
        'react-dom': join(deps, 'react-dom'),
        streamdown: join(deps, 'streamdown'),
        '@streamdown/code': join(deps, '@streamdown/code'),
        '@pierre/markdowns/react': join(
          repo,
          'packages/markdowns/dist/react.js'
        ),
        '@pierre/markdowns/highlights': join(
          repo,
          'packages/markdowns/dist/highlights.js'
        ),
        '@pierre/markdowns': join(repo, 'packages/markdowns/dist/browser.mjs'),
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
      plugins: [
        {
          name: 'comparison-renderer',
          setup(builder) {
            builder.onResolve({ filter: /^benchmark-renderer$/ }, () => ({
              path: library,
              namespace: 'comparison-renderer',
            }));
            builder.onLoad(
              { filter: /.*/, namespace: 'comparison-renderer' },
              () => ({
                contents: adapters[library],
                resolveDir: directory,
              })
            );
          },
        },
      ],
    });
    writeFileSync(
      join(destination, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Markdown comparison</title><link rel="stylesheet" href="./app.css"></head><body><div id="app"></div><script type="module" src="./app.js"></script></body></html>\n'
    );
  }
}

const metadata = {
  date: new Date().toISOString(),
  platform: `${process.platform}/${process.arch}`,
  react: JSON.parse(readFileSync(join(deps, 'react/package.json'))).version,
  streamdown: JSON.parse(readFileSync(join(deps, 'streamdown/package.json')))
    .version,
  code: JSON.parse(readFileSync(join(deps, '@streamdown/code/package.json')))
    .version,
  libraries,
  modes,
  scales,
  runs,
  timeout,
  viewport: { width: 1280, height: 960 },
  production: true,
  traced: false,
  serializedNodeInstrumentation: false,
  requestedIntervalMs: 40,
  charactersPerStep: '32 * scale',
  controls: false,
  lineNumbers: false,
  codeMaxHeight: 'none',
  codeContentVisibility: 'native defaults preserved',
  animation:
    'native 180 ms fade; Pierre delivered chunks including code, Streamdown prose words with stagger 0',
  commitTiming:
    'setCursor request to parent layout effect; excludes following paint and passive effects',
  frameTiming: 'requestAnimationFrame intervals during playback only',
  longTaskTiming: 'playback plus highlight/fade settlement',
  coldStartup:
    'excluded; distinct paragraph and TypeScript warmup, then fresh empty renderer instance; measured code is not pre-cached',
  fixture: 'repeated stress fixture; identical TS fence in each repeated unit',
};
if (!options['skip-build']) await build();
writeFileSync(
  join(output, 'metadata.json'),
  JSON.stringify(metadata, null, 2) + '\n'
);
if (options['prepare-only']) {
  console.log(
    JSON.stringify({
      ready: true,
      output,
      metadata: join(output, 'metadata.json'),
    })
  );
  process.exit(0);
}

let server;
let baseUrl = options.url;
if (!baseUrl) {
  server = createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url, 'http://localhost').pathname
    );
    const path = resolve(output, '.' + pathname);
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}
console.log(
  JSON.stringify({
    ready: true,
    baseUrl,
    output,
    metadata: join(output, 'metadata.json'),
  })
);
if (options['serve-only']) await new Promise(() => {});

const results = [];
let session;
let open = false;
const browser = (...arguments_) =>
  execFileSync('agent-browser', ['--session', session, ...arguments_], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30000,
  });
const save = () =>
  writeFileSync(
    join(output, 'summary.json'),
    JSON.stringify({ metadata, results }, null, 2) + '\n'
  );
const close = () => {
  if (!open) return;
  open = false;
  browser('close');
};
save();
try {
  for (const scale of scales)
    for (const mode of modes)
      for (let run = 0; run < runs; run++) {
        // Alternate which library runs first to reduce order and thermal bias.
        const order = run % 2 ? libraries.slice().reverse() : libraries;
        for (const library of order) {
          session = `markdown-compare-${process.pid}-${scale}-${mode}-${run}-${library}`;
          const settings = { library, mode, scale, run };
          try {
            browser(
              'open',
              `${baseUrl}/${library}/index.html?scale=${scale}&mode=${mode}`
            );
            open = true;
            browser('set', 'viewport', '1280', '960');
            browser(
              'wait',
              '--fn',
              'window.markdownComparison?.ready === true'
            );
            browser('eval', 'window.markdownComparison.start();true');
            const deadline = Date.now() + timeout;
            while (
              !JSON.parse(
                browser('eval', 'window.markdownComparison?.done === true')
              )
            ) {
              if (Date.now() > deadline)
                throw new Error(`Playback exceeded ${timeout} ms`);
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            const result = JSON.parse(
              browser('eval', 'window.markdownComparison.result()')
            );
            results.push({ ...settings, ...result });
            console.log(JSON.stringify({ ...settings, ...result }));
          } catch (error) {
            let partial = null;
            try {
              partial = JSON.parse(
                browser('eval', 'window.markdownComparison?.result() ?? null')
              );
            } catch {
              // An unresponsive renderer still counts as a bounded failure.
            }
            results.push({ ...settings, error: String(error), partial });
            console.log(JSON.stringify(results.at(-1)));
          } finally {
            save();
            close();
          }
        }
      }
} finally {
  close();
  if (server)
    await new Promise((resolve) => {
      server.close(resolve);
    });
}
