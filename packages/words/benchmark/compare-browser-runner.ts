import { execFile } from 'node:child_process';
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
import { promisify } from 'node:util';

import {
  browserArguments,
  browserCommand,
  environmentMetadata,
  harnessDependencies,
} from './environment.ts';

// Streamdown is deliberately isolated from the workspace dependency graph.
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
  'libraries',
  'scales',
  'modes',
  'runs',
  'timeout',
  'prepare-only',
  'serve-only',
  'skip-build',
  'url',
  'scroll',
  'containment',
  'section-height',
]);
for (const key of Object.keys(options))
  if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
const deps = resolve(String(options.deps ?? harnessDependencies));
const output = resolve(
  String(options.output ?? '/tmp/words-browser-comparison')
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
const scroll = String(options.scroll ?? 'top');
const containment = String(options.containment ?? 'none');
const sectionHeight = Number(options['section-height'] ?? 2000);
if (
  libraries.some((library) => !['pierre', 'streamdown'].includes(library)) ||
  modes.some((mode) => !['plain', 'highlight', 'animated'].includes(mode)) ||
  scales.some((scale) => ![1, 100, 1000].includes(scale)) ||
  !['top', 'layout', 'resize'].includes(scroll) ||
  !['none', 'code', 'blocks', 'sections'].includes(containment) ||
  !Number.isInteger(sectionHeight) ||
  sectionHeight < 100 ||
  sectionHeight > 20000 ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 10 ||
  !Number.isFinite(timeout) ||
  timeout < 1000 ||
  timeout > 600000
)
  throw new RangeError('Invalid libraries/modes/scales/runs/timeout');
mkdirSync(output, { recursive: true });

const adapters: Record<string, string> = {
  pierre: `
import { createElement } from 'react';
import { Markdown } from '@pierre/words/react';
import { createHighlightsPlugin } from '@pierre/words/highlights';
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
        '@pierre/words/react': join(repo, 'packages/words/dist/react.js'),
        '@pierre/words/highlights': join(
          repo,
          'packages/words/dist/highlights.js'
        ),
        '@pierre/words': join(repo, 'packages/words/dist/index.js'),
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
          setup(builder: {
            onResolve(
              options: { filter: RegExp },
              callback: () => { path: string; namespace: string }
            ): void;
            onLoad(
              options: { filter: RegExp; namespace: string },
              callback: () => { contents: string; resolveDir: string }
            ): void;
          }) {
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
  environment: environmentMetadata(),
  date: new Date().toISOString(),
  platform: `${process.platform}/${process.arch}`,
  react: JSON.parse(readFileSync(join(deps, 'react/package.json'), 'utf8'))
    .version,
  streamdown: JSON.parse(
    readFileSync(join(deps, 'streamdown/package.json'), 'utf8')
  ).version,
  code: JSON.parse(
    readFileSync(join(deps, '@streamdown/code/package.json'), 'utf8')
  ).version,
  libraries,
  modes,
  scales,
  runs,
  scroll,
  containment,
  sectionHeight,
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
  codeContentVisibility:
    containment === 'none'
      ? 'native defaults preserved'
      : `Pierre-only experimental ${containment} policy`,
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
if (
  !(
    options['skip-build'] != null &&
    options['skip-build'] !== false &&
    options['skip-build'] !== ''
  )
)
  await build();
if (
  !(
    options['serve-only'] != null &&
    options['serve-only'] !== false &&
    options['serve-only'] !== ''
  ) ||
  !(
    options['skip-build'] != null &&
    options['skip-build'] !== false &&
    options['skip-build'] !== ''
  )
) {
  writeFileSync(
    join(output, 'metadata.json'),
    JSON.stringify(metadata, null, 2) + '\n'
  );
}
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
    })
  );
  process.exit(0);
}

let server: ReturnType<typeof createServer> | undefined;
let baseUrl = options.url;
if (!(baseUrl != null && baseUrl !== false && baseUrl !== '')) {
  server = createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url!, 'http://localhost').pathname
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
  await new Promise<void>((resolve) => {
    server!.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
}
console.log(
  JSON.stringify({
    ready: true,
    baseUrl,
    output,
    metadata: join(output, 'metadata.json'),
  })
);
if (
  options['serve-only'] != null &&
  options['serve-only'] !== false &&
  options['serve-only'] !== ''
)
  await new Promise(() => {});

const results: Record<string, unknown>[] = [];
let session: string;
let open = false;
const execute = promisify(execFile);
const browser = async (...arguments_: string[]) =>
  (
    await execute(browserCommand(), browserArguments(session, arguments_), {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30000,
    })
  ).stdout;
const save = () =>
  writeFileSync(
    join(output, 'summary.json'),
    JSON.stringify({ metadata, results }, null, 2) + '\n'
  );
const close = async () => {
  if (!open) return;
  open = false;
  await browser('close');
};
save();
try {
  for (const scale of scales)
    for (const mode of modes)
      for (let run = 0; run < runs; run++) {
        // Alternate which library runs first to reduce order and thermal bias.
        const order = run % 2 !== 0 ? libraries.slice().reverse() : libraries;
        for (const library of order) {
          session = `words-compare-${process.pid}-${scale}-${mode}-${run}-${library}`;
          const settings = { library, mode, scale, run };
          try {
            await browser(
              'open',
              `${baseUrl}/${library}/index.html?scale=${scale}&mode=${mode}&scroll=${scroll}&containment=${containment}&section-height=${sectionHeight}`
            );
            open = true;
            await browser('set', 'viewport', '1280', '960');
            await browser(
              'wait',
              '--fn',
              'window.markdownComparison?.ready === true'
            );
            await browser('eval', 'window.markdownComparison.start();true');
            const deadline = Date.now() + timeout;
            while (
              !(
                JSON.parse(
                  await browser(
                    'eval',
                    'window.markdownComparison?.done === true'
                  )
                ) === true
              )
            ) {
              if (Date.now() > deadline)
                throw new Error(`Playback exceeded ${timeout} ms`);
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            const browserIdentity = JSON.parse(
              await browser(
                'eval',
                '({userAgent:navigator.userAgent,brands:navigator.userAgentData?.brands ?? null})'
              )
            );
            const result = JSON.parse(
              await browser('eval', 'window.markdownComparison.result()')
            );
            results.push({ ...settings, browser: browserIdentity, ...result });
            console.log(JSON.stringify({ ...settings, ...result }));
          } catch (error) {
            let partial = null;
            try {
              partial = JSON.parse(
                await browser(
                  'eval',
                  'window.markdownComparison?.result() ?? null'
                )
              );
            } catch {
              // An unresponsive renderer still counts as a bounded failure.
            }
            results.push({ ...settings, error: String(error), partial });
            console.log(JSON.stringify(results.at(-1)));
          } finally {
            save();
            await close();
          }
        }
      }
} finally {
  await close();
  if (server != null)
    await new Promise((resolve) => {
      server.close(resolve);
    });
}
