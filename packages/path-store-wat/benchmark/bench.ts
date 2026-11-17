// Engine comparison: @pierre/path-store (JS) versus @pierre/path-store-wat on
// the large fixtures. Run with `moonx path-store-wat:bench` (Bun) or
// `moonx path-store-wat:bench-node` (V8, closer to Chrome).
//
// Flags: --runs N (default 7), --skip-aosp, --only <regex>.

import { PathStore as JsPathStore } from '@pierre/path-store';
import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { init, PathStore as WasmPathStore } from '../lib/store';
import { optimizeWasm, transformWat, wat2wasm } from '../scripts/build';

const args = process.argv.slice(2);
const runs = args.includes('--runs')
  ? Number(args[args.indexOf('--runs') + 1])
  : 7;
const only = args.includes('--only')
  ? new RegExp(args[args.indexOf('--only') + 1])
  : null;
const runtime =
  process.versions.bun != null
    ? `bun ${process.versions.bun}`
    : `node ${process.version}`;

const sourceUrl = new URL('../src/path-store.wat', import.meta.url);
init(
  new WebAssembly.Module(
    optimizeWasm(wat2wasm(sourceUrl.pathname, transformWat(sourceUrl).code))
  )
);

interface Workload {
  allExpandedPaths: readonly string[] | null;
  bytes: Uint8Array;
  name: string;
  paths: readonly string[];
}

function loadWorkloads(): Workload[] {
  const workloads: Workload[] = [];
  const linux = getVirtualizationWorkload('linux-10x');
  workloads.push({
    allExpandedPaths: linux.expandedFolders,
    bytes: new TextEncoder().encode(linux.presortedFiles.join('\n')),
    name: 'linux-10x',
    paths: linux.presortedFiles,
  });
  const aospPath = new URL(
    '../../../apps/docs/public/trees-dev/aosp-files.json.gz',
    import.meta.url
  );
  if (!args.includes('--skip-aosp') && existsSync(aospPath)) {
    const parsed = JSON.parse(
      gunzipSync(readFileSync(aospPath)).toString('utf8')
    ) as {
      allExpandedPaths: string[];
      paths: string[];
    };
    workloads.push({
      allExpandedPaths: parsed.allExpandedPaths,
      bytes: new TextEncoder().encode(parsed.paths.join('\n')),
      name: 'aosp',
      paths: parsed.paths,
    });
  }
  return workloads;
}

interface Sample {
  name: string;
  p50: number;
  min: number;
}

const samples: Sample[] = [];

function bench(name: string, fn: () => unknown): void {
  if (only != null && !only.test(name)) {
    return;
  }
  const times: number[] = [];
  fn();
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((left, right) => left - right);
  const sample = { min: times[0], name, p50: times[times.length >> 1] };
  samples.push(sample);
  console.log(
    `${name.padEnd(64)} p50 ${sample.p50.toFixed(1).padStart(8)} ms   min ${sample.min.toFixed(1).padStart(8)} ms`
  );
}

type Engine = 'js' | 'wasm';

function createStore(
  engine: Engine,
  options: ConstructorParameters<typeof JsPathStore>[0]
): JsPathStore | WasmPathStore {
  return engine === 'js'
    ? new JsPathStore(options)
    : new WasmPathStore(options);
}

console.log(`runtime: ${runtime}\n`);

for (const workload of loadWorkloads()) {
  const presorted = JsPathStore.preparePresortedInput(workload.paths);
  const presortedBytes = WasmPathStore.preparePresortedBytes(workload.bytes);
  console.log(
    `== ${workload.name}: ${workload.paths.length.toLocaleString()} paths, ${(workload.bytes.length / 1e6).toFixed(1)} MB`
  );

  for (const engine of ['js', 'wasm'] as const) {
    bench(`${workload.name}/build/open/${engine}`, () =>
      createStore(engine, {
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        preparedInput: presorted,
      }).getNodeCount());
  }
  bench(`${workload.name}/build/open/wasm-bytes`, () =>
    new WasmPathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      preparedInput: presortedBytes,
    }).getNodeCount());
  for (const engine of ['js', 'wasm'] as const) {
    bench(`${workload.name}/build/closed/${engine}`, () =>
      createStore(engine, {
        flattenEmptyDirectories: true,
        preparedInput: presorted,
      }).getNodeCount());
  }
  if (workload.allExpandedPaths != null) {
    for (const engine of ['js', 'wasm'] as const) {
      bench(`${workload.name}/build/initialExpandedPaths(all)/${engine}`, () =>
        createStore(engine, {
          flattenEmptyDirectories: true,
          initialExpandedPaths: workload.allExpandedPaths ?? [],
          preparedInput: presorted,
        }).getNodeCount());
    }
  }
  for (const engine of ['js', 'wasm'] as const) {
    bench(`${workload.name}/build+first-window(200)/open/${engine}`, () => {
      const store = createStore(engine, {
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        preparedInput: presorted,
      });
      return (
        store.getVisibleTreeProjectionData(200).paths.length +
        store.getVisibleSlice(0, 60).length
      );
    });
  }

  // steady-state reads and mutations on an open tree
  for (const engine of ['js', 'wasm'] as const) {
    const store = createStore(engine, {
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      preparedInput: presorted,
    });
    const visible = store.getVisibleCount();
    const windows = [0, visible >> 2, visible >> 1, visible - 100];
    const directory =
      store
        .getVisibleSlice(0, 1)
        .map((row) => row.path)
        .find((path) => path.endsWith('/')) ?? '';
    const deepRow = store
      .getVisibleSlice(visible >> 1, (visible >> 1) + 50)
      .find((row) => row.kind === 'file');
    const deepFile = deepRow?.path ?? '';
    const deepDir = deepFile.slice(0, deepFile.lastIndexOf('/') + 1);
    bench(`${workload.name}/read/getVisibleSlice x4 windows of 60/${engine}`, () =>
      windows.reduce(
        (count, start) =>
          count + store.getVisibleSlice(start, start + 59).length,
        0
      ));
    bench(`${workload.name}/read/getVisibleRowContext mid/${engine}`, () =>
      store.getVisibleRowContext(visible >> 1)?.ancestorRows.length);
    bench(`${workload.name}/read/getVisibleIndex deep file/${engine}`, () =>
      store.getVisibleIndex(deepFile));
    bench(`${workload.name}/read/projection full/${engine}`, () =>
      store.getVisibleTreeProjectionData().paths.length);
    bench(`${workload.name}/mutate/collapse+expand root dir/${engine}`, () => {
      store.collapse(directory);
      store.expand(directory);
    });
    bench(`${workload.name}/mutate/add+remove deep file/${engine}`, () => {
      store.add(`${deepDir}zz-bench-file.txt`);
      store.remove(`${deepDir}zz-bench-file.txt`);
    });
    bench(`${workload.name}/mutate/move file to root and back/${engine}`, () => {
      store.move(deepFile, 'zz-bench-moved.txt');
      store.move('zz-bench-moved.txt', deepFile);
    });
  }
  console.log('');
}

console.log('summary (p50 ms, lower is better):');
const byScenario = new Map<string, Map<string, number>>();
for (const sample of samples) {
  const slash = sample.name.lastIndexOf('/');
  const scenario = sample.name.slice(0, slash);
  const engine = sample.name.slice(slash + 1);
  const row = byScenario.get(scenario) ?? new Map<string, number>();
  row.set(engine, sample.p50);
  byScenario.set(scenario, row);
}
for (const [scenario, row] of byScenario) {
  const js = row.get('js');
  const wasm = row.get('wasm');
  const bytes = row.get('wasm-bytes');
  const ratio = js != null && wasm != null ? `${(js / wasm).toFixed(2)}x` : '';
  console.log(
    `${scenario.padEnd(60)} js ${js?.toFixed(1).padStart(8) ?? '       -'}  wasm ${wasm?.toFixed(1).padStart(8) ?? '       -'}${bytes != null ? `  wasm-bytes ${bytes.toFixed(1).padStart(8)}` : ''}  ${ratio}`
  );
}
