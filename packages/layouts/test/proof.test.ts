import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

// The proof of the two entry points: build the library as it ships, then
// build two apps that import `@pierre/layouts/react` from it, with Rolldown
// (through Vite, as the bundle step does) and with esbuild, in app mode. A
// part or a feature that an app does not use, and its sheet, must not be in
// the app's output.

const PACKAGE = join(import.meta.dir, '..');

// The budget of app A, with its CSS, for each build that the test measures
// (`DEC-layouts-modular-size-budget`). Bytes, minified and brotli. The owner
// accepted 28,515 / 9,651 from the source after step 16 of
// `refactor-entries-feature-modules`. The review fixes of 2026-11-16 add the
// title of each pane to its state (`DEC-layouts-pane-state-hook`) and the
// opt-in announcement of remote changes (`DEC-layouts-messages-option`), and
// the accessibility fixes that follow add the separator's pointer target and
// focus style and the pane header's names and sizes
// (`DEC-layouts-accessibility-bar`). The pane commands give the two-pane
// budget its new value (`DEC-layouts-pane-commands`): F6, the keymap, and the
// step buttons of a separator. Their results name the cost of each. The brotli size of the
// esbuild build moves by up to 50 bytes when the files of the dist change,
// with the same minified size, so its budget is 50 bytes above the measured
// size.
const BUDGET = {
  'two-pane source': { minified: 33_573, brotli: 11_230 },
  'two-pane rolldown': { minified: 33_579, brotli: 11_254 },
  'two-pane esbuild': { minified: 34_039, brotli: 11_982 },
} as const;

// The budgets of the full set (app C, `allFeatures()` and every part) and of
// the app with tab stacks and `tabDrag()` (app E), from the source, as the
// bundle step measures them, a few bytes apart from the bundle step's own
// values (`DEC-layouts-modular-size-budget`). The owner
// accepted the full set at 72,104 / 21,812 after the tab gaps; app E was
// 57,711 / 18,052 then. The review fixes of 2026-11-16 add the titles in the
// pane state, the remote announcement, the sheet of sticky pinned tabs, and
// the drag with no image; their results name the cost of each.
const APP_BUDGET = {
  'full set source': { minified: 84_060, brotli: 25_216 },
  'tab stacks source': { minified: 65_523, brotli: 20_261 },
} as const;

interface Output {
  code: string;
  minified: number;
  brotli: number;
}

const brotli = (code: string): number =>
  brotliCompressSync(Buffer.from(code), {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    },
  }).length;

// The installed package: its `package.json`, whose `sideEffects` lets a
// bundler drop the files of the dist that an app does not use, and the dist.
let installed = '';
let dist = '';
const outputs = new Map<string, Output>();

/** The entries of the built library, for the resolver of each bundler. */
const aliases = (): Record<string, string> => ({
  '@pierre/layouts/react': join(dist, 'react/index.js'),
  '@pierre/layouts': join(dist, 'index.js'),
});

/** The entries of the source, for the reference build of app A. */
const sourceAliases = (): Record<string, string> => ({
  '@pierre/layouts/react': join(PACKAGE, 'src/react/index.tsx'),
  '@pierre/layouts': join(PACKAGE, 'src/index.ts'),
});

async function rolldown(
  entry: string,
  alias: Record<string, string> = aliases()
): Promise<string> {
  const { build } = await import('vite');
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root: PACKAGE,
    define: { 'process.env.NODE_ENV': '"production"' },
    resolve: { alias },
    build: {
      write: false,
      minify: true,
      lib: { entry, formats: ['es'], fileName: 'app' },
      rolldownOptions: {
        external: [/^react($|\/)/, /^react-dom($|\/)/],
        output: { minify: true, comments: false },
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((output) =>
    'output' in output ? output.output : []
  );
  return chunks
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('');
}

interface Chunk {
  code: string;
  /** The chunks that this chunk imports statically. */
  imports: readonly string[];
  isEntry: boolean;
}

/** The chunks of an app that Rolldown splits at its dynamic imports, by file name. */
async function rolldownChunks(entry: string): Promise<Map<string, Chunk>> {
  const { build } = await import('vite');
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root: PACKAGE,
    define: { 'process.env.NODE_ENV': '"production"' },
    resolve: { alias: aliases() },
    build: {
      write: false,
      minify: true,
      rolldownOptions: {
        input: entry,
        preserveEntrySignatures: 'exports-only',
        external: [/^react($|\/)/, /^react-dom($|\/)/],
        output: { minify: true, comments: false },
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((output) =>
    'output' in output ? output.output : []
  );
  return new Map(
    chunks.flatMap((chunk) =>
      chunk.type === 'chunk'
        ? [
            [
              chunk.fileName,
              {
                code: chunk.code,
                imports: chunk.imports,
                isEntry: chunk.isEntry,
              },
            ] as const,
          ]
        : []
    )
  );
}

let splitApp = new Map<string, Chunk>();

async function esbuild(entry: string): Promise<string> {
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    jsx: 'automatic',
    legalComments: 'none',
    logLevel: 'error',
    external: ['react', 'react-dom', 'react/*'],
    alias: aliases(),
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return result.outputFiles.map((file) => file.text).join('');
}

const measure = (code: string): Output => ({
  code,
  minified: code.length,
  brotli: brotli(code),
});

beforeAll(async () => {
  // The test runner sets `NODE_ENV` to `test`, and Vite then compiles the JSX
  // of an app for development. The builds are production builds.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    installed = mkdtempSync(join(tmpdir(), 'pierre-layouts-proof-'));
    copyFileSync(
      join(PACKAGE, 'package.json'),
      join(installed, 'package.json')
    );
    dist = join(installed, 'dist');
    const { build } = await import('tsdown');
    await build({
      cwd: PACKAGE,
      config: join(PACKAGE, 'tsdown.config.ts'),
      outDir: dist,
      dts: false,
      logLevel: 'silent',
    });
    for (const app of ['two-pane', 'tiled'])
      for (const [bundler, bundle] of [
        ['rolldown', rolldown],
        ['esbuild', esbuild],
      ] as const)
        outputs.set(
          `${app} ${bundler}`,
          measure(await bundle(join(PACKAGE, `test/proof/${app}.tsx`)))
        );
    splitApp = await rolldownChunks(join(PACKAGE, 'test/proof/eager-root.tsx'));
    outputs.set(
      'two-pane source',
      measure(
        await rolldown(
          join(PACKAGE, 'test/proof/two-pane.tsx'),
          sourceAliases()
        )
      )
    );
    // The full set and the app with tab stacks, as the bundle step builds
    // them from the source.
    for (const [name, file] of [
      ['full set source', 'bench/apps/full.tsx'],
      ['tab stacks source', 'bench/apps/tabs.tsx'],
    ] as const)
      outputs.set(name, measure(await rolldown(join(PACKAGE, file))));
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
}, 120_000);

afterAll(() => {
  if (installed !== '') rmSync(installed, { recursive: true, force: true });
});

// A mark of each part, feature, and sheet in an output. A sheet is a minified
// string, so its mark is one of its rules.
const MARKS = {
  splitSheet: '.pierre-layouts-separator{',
  headersSheet: '.pierre-layouts-title{',
  contentSheet: '.pierre-layouts-content{',
  tabsSheet: '.pierre-layouts-tabs{',
  zoomSheet: '[data-zoomed=true]',
  cornersSheet: '.pierre-layouts-corner{',
  dropSheet: '.pierre-layouts-drop{',
  flipSheet: 'transform-origin:0 0',
  focusRingSheet: '.pierre-layouts-focus{',
  overlaysSheet: '.pierre-overlay{',
  tabDragSheet: '.pierre-layouts-tab-drop{',
  moveHandle: 'pierre-layouts-grip',
  tab: 'pierre-layouts-tab-title',
  usePane: 'must be in the output of renderPane',
  developmentChecks: 'renderPane changed',
} as const;

const has = (output: Output, mark: keyof typeof MARKS): boolean =>
  output.code.includes(MARKS[mark]);

describe.each(['rolldown', 'esbuild'])('%s', (bundler) => {
  test('app A holds Root and the split sheet, and no part or feature', () => {
    const output = outputs.get(`two-pane ${bundler}`);
    if (output === undefined) throw new Error('Missing output');
    expect(has(output, 'splitSheet')).toBe(true);
    for (const mark of [
      'headersSheet',
      'contentSheet',
      'tabsSheet',
      'zoomSheet',
      'cornersSheet',
      'dropSheet',
      'flipSheet',
      'focusRingSheet',
      'overlaysSheet',
      'moveHandle',
      'tab',
      'usePane',
      'developmentChecks',
    ] as const)
      expect([mark, has(output, mark)]).toEqual([mark, false]);
  });

  test('app B holds its parts, its features, and their sheets, and no other', () => {
    const output = outputs.get(`tiled ${bundler}`);
    if (output === undefined) throw new Error('Missing output');
    for (const mark of [
      'splitSheet',
      'headersSheet',
      'contentSheet',
      'zoomSheet',
      'cornersSheet',
      'dropSheet',
      'moveHandle',
      'usePane',
    ] as const)
      expect([mark, has(output, mark)]).toEqual([mark, true]);
    for (const mark of [
      'tabsSheet',
      'flipSheet',
      'focusRingSheet',
      'overlaysSheet',
      'tabDragSheet',
      'tab',
      'developmentChecks',
    ] as const)
      expect([mark, has(output, mark)]).toEqual([mark, false]);
  });
});

test('the sizes of the apps', () => {
  const sizes = Object.fromEntries(
    [...outputs].map(([name, { minified, brotli: compressed }]) => [
      name,
      `${minified} / ${compressed}`,
    ])
  );
  console.log(JSON.stringify(sizes, null, 1));
  expect(Object.keys(sizes)).toHaveLength(7);
});

// The dist joins modules into a few files, so a bundler can drop only the
// top-level code of a file that it can prove pure. A top-level call without a
// pure mark (for example a `memo` of a component that the app does not use)
// stays in every app. A few bytes of slack absorb the other order of modules.
test('app A from the dist costs no more than app A from the source', () => {
  const fromDist = outputs.get('two-pane rolldown');
  const fromSource = outputs.get('two-pane source');
  if (fromDist === undefined || fromSource === undefined)
    throw new Error('Missing output');
  expect(fromDist.minified).toBeLessThanOrEqual(fromSource.minified + 32);
});

test.each(Object.entries(BUDGET))(
  '%s is within the budget of app A',
  (name, budget) => {
    const output = outputs.get(name);
    if (output === undefined) throw new Error('Missing output');
    expect(output.minified).toBeLessThanOrEqual(budget.minified);
    expect(output.brotli).toBeLessThanOrEqual(budget.brotli);
  }
);

test.each(Object.entries(APP_BUDGET))(
  '%s is within its budget',
  (name, budget) => {
    const output = outputs.get(name);
    if (output === undefined) throw new Error('Missing output');
    expect(output.minified).toBeLessThanOrEqual(budget.minified);
    expect(output.brotli).toBeLessThanOrEqual(budget.brotli);
  }
);

// An app imports the root entry at once and the React entry behind a dynamic
// import. A bundler places each module of the dist in the chunk of its user,
// so the eager chunk holds the parser of the saved tree and none of the view
// or the commands.
test('an eager import of the root entry takes none of the lazy view into the eager chunks', () => {
  // The entry chunk and each chunk that it imports statically load at once.
  const eager = new Set<string>();
  const visit = (name: string): void => {
    if (eager.has(name)) return;
    eager.add(name);
    for (const imported of splitApp.get(name)?.imports ?? []) visit(imported);
  };
  for (const [name, chunk] of splitApp) if (chunk.isEntry) visit(name);
  const code = [...eager].map((name) => splitApp.get(name)?.code).join('');
  const lazy = [...splitApp]
    .filter(([name]) => !eager.has(name))
    .map(([, chunk]) => chunk.code)
    .join('');
  expect(code).toContain('must be 3');
  for (const mark of [
    '.pierre-layouts-separator{',
    'must be in the output of renderPane',
    'moved into the group of',
    'zoomed',
    'unknown_operation',
    'id_in_use',
  ])
    expect([mark, code.includes(mark)]).toEqual([mark, false]);
  expect(lazy).toContain('.pierre-layouts-separator{');
  expect(code.length).toBeLessThan(8_000);
});
