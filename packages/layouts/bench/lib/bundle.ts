import { fileURLToPath } from 'node:url';
import {
  brotliCompressSync,
  constants,
  gzipSync,
  zstdCompressSync,
} from 'node:zlib';
import { build, type Rolldown } from 'vite';

/** Sizes in bytes of one bundle: minified, then compressed as a server sends it. */
export interface BundleSize {
  minified: number;
  gzip: number;
  brotli: number;
  zstd: number;
}

/**
 * How the step minifies each bundle. `app` removes whitespace and comments, as
 * an app build ships the code. `library` is the output of Vite's library mode
 * with the `es` format, which runs the minifier without its code generator, so
 * whitespace and region comments stay. Reports before the `app` mode recorded
 * only `library` values.
 */
export type BundleMode = 'app' | 'library';

/** The size of each entry point and each consumer, in each mode. */
export type BundleSizes = Record<BundleMode, Record<string, BundleSize>>;

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

// Each entry is bundled on its own with all of its imports, as an app that
// imports only that entry would get it. React stays external.
const ENTRIES: Record<string, string> = {
  '@pierre/layouts': 'src/index.ts',
  '@pierre/layouts/react': 'src/react/index.tsx',
  '@pierre/layouts/styles.css': 'src/styles.css',
  '@pierre/layouts/overlays': 'src/overlays/index.ts',
  '@pierre/layouts/react/overlays': 'src/react/overlays.tsx',
  '@pierre/layouts/overlays.css': 'src/overlays.css',
};

// Each consumer is the module of an app that imports what the app uses, from
// one or more entry points. The module exports the imports again, so that the
// bundle keeps the code that they need, as an app that uses them does. The
// React entry imports `LayoutStore` only as a type, so an app that renders
// `Layout` loads code that the entry alone leaves out.
const CONSUMERS: Record<string, string> = {
  'consumer: Layout + LayoutStore': [
    "export { Layout } from '/src/react/index.tsx';",
    "export { LayoutStore } from '/src/index.ts';",
  ].join('\n'),
};

// Each example app is a module of an app that renders a layout, with the
// stylesheets that it loads. Its size is the JavaScript file and the CSS file
// that the app ships, each compressed alone, added together. The apps match
// the examples of the modular entry points proposal, so that the sizes before
// and after the change compare: A is a fixed two-pane split with collapse, B a
// tiled grid with move and zoom, C the full set of features, and D the side
// panel of an agent app.
const APPS: Record<string, string> = {
  'app A: two-pane split': 'bench/apps/two-pane.tsx',
  'app B: tiled grid': 'bench/apps/tiled.tsx',
  'app C: full set': 'bench/apps/full.tsx',
  'app D: side panel': 'bench/apps/side-panel.tsx',
};

const MODES: readonly BundleMode[] = ['app', 'library'];

// The ID of the entry module that the step writes for a stylesheet or a consumer.
const VIRTUAL_ENTRY = 'virtual:bench-entry';

/**
 * One bundle: an entry file of the package, or the source of an entry module
 * that the step writes. `output` names the files of the build that count: the
 * JavaScript, the CSS, or both.
 */
interface BundleInput {
  entry: { file: string } | { source: string };
  output: 'js' | 'css' | 'both';
}

/** The JavaScript and the CSS of one build. Each is empty when the build has none. */
interface BundleOutput {
  js: string;
  css: string;
}

function compress(code: string): BundleSize {
  const input = Buffer.from(code);
  return {
    minified: input.length,
    // Level 9 gzip is the reference that most size tools report.
    gzip: gzipSync(input, { level: 9 }).length,
    // Quality 11 is the setting for static assets; servers use it for prebuilt files.
    brotli: brotliCompressSync(input, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      },
    }).length,
    zstd: zstdCompressSync(input, {
      params: { [constants.ZSTD_c_compressionLevel]: 19 },
    }).length,
  };
}

// The sizes of two files that an app ships side by side.
function addSizes(a: BundleSize, b: BundleSize): BundleSize {
  return {
    minified: a.minified + b.minified,
    gzip: a.gzip + b.gzip,
    brotli: a.brotli + b.brotli,
    zstd: a.zstd + b.zstd,
  };
}

// Build one bundle with Vite's library mode and return its JavaScript chunks
// and its CSS assets, each joined into one string.
async function bundle(
  input: BundleInput,
  mode: BundleMode
): Promise<BundleOutput> {
  const source = 'source' in input.entry ? input.entry.source : null;
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root: PACKAGE_DIR,
    // An app build replaces `process.env.NODE_ENV`, so that code for
    // development only drops.
    ...(mode === 'app'
      ? { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }
      : {}),
    build: {
      write: false,
      minify: true,
      cssMinify: true,
      cssCodeSplit: false,
      lib: {
        entry: 'file' in input.entry ? input.entry.file : VIRTUAL_ENTRY,
        formats: ['es'],
        fileName: 'entry',
      },
      rolldownOptions: {
        external: [/^react($|\/)/, /^react-dom($|\/)/],
        // Library mode keeps whitespace and comments. The minifier with its
        // code generator, and no comments, gives the code that an app ships.
        ...(mode === 'app'
          ? { output: { minify: true, comments: false } }
          : {}),
      },
    },
    plugins:
      source === null
        ? []
        : [
            {
              name: 'bench-entry',
              enforce: 'pre' as const,
              // Vite resolves the lib entry against the root first, so match the suffix.
              resolveId: (id) =>
                id.endsWith(VIRTUAL_ENTRY) ? '\0bench-entry' : null,
              load: (id) => (id === '\0bench-entry' ? source : null),
            },
          ],
  });
  const outputs = (
    Array.isArray(result) ? result : [result]
  ) as Rolldown.RolldownOutput[];
  const files = outputs.flatMap((output) => output.output);
  return {
    js: files
      .flatMap((file) => (file.type === 'chunk' ? [file.code] : []))
      .join('\n'),
    css: files
      .flatMap((file) =>
        file.type === 'asset' && file.fileName.endsWith('.css')
          ? [String(file.source)]
          : []
      )
      .join('\n'),
  };
}

// Build one bundle and return the size of the files that count. Each file is
// compressed alone, as a server sends it.
async function measure(
  input: BundleInput,
  mode: BundleMode
): Promise<BundleSize> {
  const { js, css } = await bundle(input, mode);
  const wanted = [
    ...(input.output === 'css' ? [] : [js]),
    ...(input.output === 'js' ? [] : [css]),
  ];
  if (wanted.some((code) => code === '')) {
    throw new Error(`No ${input.output} output for ${JSON.stringify(input)}`);
  }
  return wanted.map(compress).reduce(addSizes);
}

// The input of an entry point. A stylesheet needs an entry module that
// imports it, so that the build writes it as an asset.
function entryInput(path: string): BundleInput {
  return path.endsWith('.css')
    ? { entry: { source: `import '/${path}';` }, output: 'css' }
    : { entry: { file: path }, output: 'js' };
}

/**
 * Bundle, minify, and compress each entry point, each consumer, and each
 * example app, in each mode.
 */
export async function measureBundles(): Promise<BundleSizes> {
  const inputs: [string, BundleInput][] = [
    ...Object.entries(ENTRIES).map(([name, path]): [string, BundleInput] => [
      name,
      entryInput(path),
    ]),
    ...Object.entries(CONSUMERS).map(
      ([name, source]): [string, BundleInput] => [
        name,
        { entry: { source }, output: 'js' },
      ]
    ),
    ...Object.entries(APPS).map(([name, file]): [string, BundleInput] => [
      name,
      { entry: { file }, output: 'both' },
    ]),
  ];
  const sizes: BundleSizes = { app: {}, library: {} };
  for (const mode of MODES) {
    for (const [name, input] of inputs) {
      sizes[mode][name] = await measure(input, mode);
    }
  }
  return sizes;
}

// Print the sizes of one mode as a table in kilobytes.
function formatMode(sizes: Record<string, BundleSize>): string {
  const kb = (bytes: number): string => (bytes / 1024).toFixed(2);
  const rows = [
    ['bundle', 'minified KB', 'gzip KB', 'brotli KB', 'zstd KB'],
    ...Object.entries(sizes).map(([name, size]) => [
      name,
      kb(size.minified),
      kb(size.gzip),
      kb(size.brotli),
      kb(size.zstd),
    ]),
  ];
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length))
  );
  return rows
    .map((row) =>
      row.map((cell, column) => cell.padEnd(widths[column])).join('  ')
    )
    .join('\n');
}

/** Print the sizes as one table for each mode, app mode first. */
export function formatBundles(sizes: BundleSizes): string {
  return MODES.map(
    (mode) => `Bundle sizes, ${mode} mode:\n${formatMode(sizes[mode])}`
  ).join('\n\n');
}
