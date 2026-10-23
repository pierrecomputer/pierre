import { fileURLToPath } from 'node:url';
import {
  brotliCompressSync,
  constants,
  gzipSync,
  zstdCompressSync,
} from 'node:zlib';
import { build, type Rolldown } from 'vite';

/** Sizes in bytes of one entry point: minified, then compressed as a server sends it. */
export interface BundleSize {
  minified: number;
  gzip: number;
  brotli: number;
  zstd: number;
}

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

// Each entry is bundled on its own with all of its imports, as an app that
// imports only that entry would get it. React stays external.
const ENTRIES: Record<string, string> = {
  '@pierre/layouts': 'src/index.ts',
  '@pierre/layouts/react': 'src/react/index.tsx',
  '@pierre/layouts/styles.css': 'src/styles.css',
};

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

async function bundle(entry: string): Promise<string> {
  const css = entry.endsWith('.css');
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root: PACKAGE_DIR,
    build: {
      write: false,
      minify: true,
      cssMinify: true,
      cssCodeSplit: false,
      lib: {
        entry: css ? 'virtual:styles-entry' : entry,
        formats: ['es'],
        fileName: 'entry',
      },
      rolldownOptions: {
        external: [/^react($|\/)/, /^react-dom($|\/)/],
      },
    },
    plugins: css
      ? [
          {
            name: 'styles-entry',
            enforce: 'pre' as const,
            // Vite resolves the lib entry against the root first, so match the suffix.
            resolveId: (id) =>
              id.endsWith('virtual:styles-entry') ? '\0styles-entry' : null,
            load: (id) =>
              id === '\0styles-entry' ? `import '/${entry}';` : null,
          },
        ]
      : [],
  });
  const outputs = (
    Array.isArray(result) ? result : [result]
  ) as Rolldown.RolldownOutput[];
  const files = outputs.flatMap((output) => output.output);
  const wanted = files.filter((file) =>
    css
      ? file.type === 'asset' && file.fileName.endsWith('.css')
      : file.type === 'chunk'
  );
  if (wanted.length === 0) throw new Error(`No output for ${entry}`);
  return wanted
    .map((file) => (file.type === 'chunk' ? file.code : String(file.source)))
    .join('\n');
}

/** Bundle, minify, and compress each entry point of the package. */
export async function measureBundles(): Promise<Record<string, BundleSize>> {
  const sizes: Record<string, BundleSize> = {};
  for (const [name, entry] of Object.entries(ENTRIES)) {
    sizes[name] = compress(await bundle(entry));
  }
  return sizes;
}

/** Print the sizes as a table in kilobytes. */
export function formatBundles(sizes: Record<string, BundleSize>): string {
  const kb = (bytes: number): string => (bytes / 1024).toFixed(2);
  const rows = [
    ['entry', 'minified KB', 'gzip KB', 'brotli KB', 'zstd KB'],
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
