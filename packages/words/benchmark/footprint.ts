import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { environmentMetadata, harnessDependencies } from './environment.ts';

const [dependencies, destination] = process.argv.slice(2);
if ((destination ?? '') === '')
  throw new Error(
    'Expected [isolated node_modules] [output directory]; use words:bench-quick for the portable default.'
  );
const deps = resolve(
  (dependencies ?? '') !== '' ? dependencies : harnessDependencies
);
const output = resolve(destination);
const require = createRequire(join(deps, '../package.json'));
const { build } = require('esbuild');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const alias = Object.fromEntries(
  [
    ['@pierre/words/react', 'packages/words/dist/react.js'],
    ['@pierre/words/html', 'packages/words/dist/html.js'],
    ['@pierre/words/highlights', 'packages/words/dist/highlights.js'],
    ['@pierre/words', 'packages/words/dist/index.js'],
    ['@pierre/highlights', 'packages/highlights/dist/default.js'],
  ].map(([name, path]) => [name, join(root, path)])
);
const variants = {
  pierreHtml: 'export * from "@pierre/words/html";',
  pierreBase: 'export { Markdown } from "@pierre/words/react";',
  pierreCode: `export { Markdown } from '@pierre/words/react';
    import { createHighlightsPlugin } from '@pierre/words/highlights';
    import light from '${join(root, 'packages/highlights/dist/themes/pierre-light.js')}';
    import dark from '${join(root, 'packages/highlights/dist/themes/pierre-dark.js')}';
    export const code = createHighlightsPlugin({themes:{light,dark},defaultColor:'light-dark()'});`,
  streamdownBase: 'export { Streamdown } from "streamdown";',
  streamdownCode:
    'export { Streamdown } from "streamdown"; export { code } from "@streamdown/code";',
};
mkdirSync(output, { recursive: true });
const report = {
  environment: environmentMetadata(),
  date: new Date().toISOString(),
  bundler: require('esbuild/package.json').version,
  notes: [
    'Minified ES2022 browser ESM; React/React DOM external. Each JS file gzip level 9 independently.',
    'Configured code closure includes TypeScript, default light/dark themes, and highlighted-body lazy chunks.',
    'Pierre includes its monolithic grammar set; Streamdown lazily imports individual grammars.',
    'CSS is separate; application-specific Streamdown Tailwind utility CSS is excluded.',
  ],
  variants: {} as Record<
    string,
    {
      initial: { raw: number; gzip: number };
      configured: { raw: number; gzip: number };
      files: { path: string; raw: number; gzip: number }[];
    }
  >,
  css: {} as Record<string, { raw: number; gzip: number }>,
};
for (const [name, contents] of Object.entries(variants)) {
  const result = await build({
    stdin: {
      contents,
      resolveDir: resolve(deps, '..'),
      sourcefile: `${name}.js`,
    },
    bundle: true,
    minify: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    outdir: join(output, name),
    entryNames: 'entry',
    chunkNames: 'chunks/[name]-[hash]',
    metafile: true,
    alias,
    logLevel: 'silent',
  });
  const outputs = result.metafile.outputs;
  const names = Object.keys(outputs).filter((path) => path.endsWith('.js'));
  const entry = names.find((path) =>
    Boolean(outputs[path].entryPoint?.includes(name))
  );
  if (!entry) throw new Error(`Missing entry: ${name}`);
  // Follow static imports; add only the lazy chunks needed by this configured workload.
  const visit = (path: string, set: Set<string>) => {
    if (set.has(path)) return;
    set.add(path);
    for (const dependency of outputs[path]?.imports ?? [])
      if (dependency.external !== true && dependency.kind !== 'dynamic-import')
        visit(dependency.path, set);
  };
  const eager = new Set<string>();
  visit(entry, eager);
  const configured = new Set(eager);
  for (const path of names)
    if (
      /\/(typescript|github-light|github-dark)-[A-Z0-9]{8}\.js$|\/highlighted-body-[^/]+\.js$/.test(
        path
      )
    )
      visit(path, configured);
  const files = names.map((path) => {
    const bytes = readFileSync(path);
    return {
      path,
      raw: bytes.length,
      gzip: gzipSync(bytes, { level: 9 }).length,
    };
  });
  const sum = (set: Set<string>) =>
    files
      .filter((file) => set.has(file.path))
      .reduce(
        (total, file) => ({
          raw: total.raw + file.raw,
          gzip: total.gzip + file.gzip,
        }),
        { raw: 0, gzip: 0 }
      );
  report.variants[name] = {
    initial: sum(eager),
    configured: sum(configured),
    files,
  };
}
report.css = Object.fromEntries(
  [
    ['pierre', join(root, 'packages/words/dist/styles.css')],
    ['streamdown', join(deps, 'streamdown/styles.css')],
  ].map(([name, path]) => {
    const bytes = readFileSync(path);
    return [
      name,
      { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length },
    ];
  })
);
writeFileSync(
  join(output, 'summary.json'),
  JSON.stringify(report, null, 2) + '\n'
);
console.log(
  JSON.stringify(
    {
      ...report,
      environment: undefined,
      variants: Object.fromEntries(
        Object.entries(report.variants).map(
          ([name, { files: _files, ...sizes }]) => [name, sizes]
        )
      ),
    },
    null,
    2
  )
);
