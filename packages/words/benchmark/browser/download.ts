import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { environment } from '../shared.ts';

export interface DownloadRun {
  date: string;
  commit: string;
  dirty: boolean;
  bun: string;
  versions: Record<string, string>;
}

export interface DownloadReport {
  download: Record<string, Record<string, number>>;
  downloadRun: DownloadRun;
}

const directory = import.meta.dir;

/** Measure the same consumer bundles independently of browser timing replays. */
export async function measureDownload(): Promise<DownloadReport> {
  const system = environment([
    'react',
    'streamdown',
    '@streamdown/code',
    '@playwright/test',
  ]);
  const downloadRun: DownloadRun = {
    date: system.date,
    commit: (await Bun.$`git rev-parse HEAD`.cwd(directory).text()).trim(),
    dirty:
      (await Bun.$`git status --porcelain`.cwd(directory).text()).trim() !== '',
    bun: Bun.version,
    versions: system.versions,
  };

  // Minified ESM with React external; each JS file gzipped on its own.
  const variants = {
    base: {
      words: "export { Markdown } from '@pierre/words/react';",
      streamdown: "export { Streamdown } from 'streamdown';",
    },
    highlight: {
      words: `export { Markdown } from '@pierre/words/react';
      export { createHighlightsPlugin } from '@pierre/words/highlights';
      export { default as light } from '@pierre/highlights/themes/pierre-light';
      export { default as dark } from '@pierre/highlights/themes/pierre-dark';`,
      streamdown: `export { Streamdown } from 'streamdown';
      export { code } from '@streamdown/code';`,
    },
  };
  const entry = join(directory, 'entry.js');
  const download: Record<string, Record<string, number>> = {};
  for (const [id, entries] of Object.entries(variants)) {
    download[id] = {};
    for (const [library, contents] of Object.entries(entries)) {
      const { outputs, metafile } = await Bun.build({
        entrypoints: [entry],
        files: { [entry]: contents },
        target: 'browser',
        format: 'esm',
        splitting: true,
        minify: true,
        external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
        metafile: true,
      });
      const chunks = metafile!.outputs;
      const sizes = new Map<string, number>();
      for (const file of outputs)
        sizes.set(
          file.path,
          Bun.gzipSync(new Uint8Array(await file.arrayBuffer()), { level: 9 })
            .length
        );
      const loaded = new Set<string>();
      const visit = (path: string) => {
        if (loaded.has(path)) return;
        loaded.add(path);
        for (const { path: next, kind } of chunks[path].imports)
          if (kind !== 'dynamic-import') visit(next);
      };
      visit(outputs.find((file) => file.kind === 'entry-point')!.path);
      // Streamdown loads the TypeScript grammar, its default themes, and the highlighted body on demand.
      if (id === 'highlight' && library === 'streamdown')
        for (const input of [
          /langs\/dist\/typescript\.mjs$/,
          /themes\/dist\/github-light\.mjs$/,
          /themes\/dist\/github-dark\.mjs$/,
          /\/highlighted-body-\w+\.js$/,
        ]) {
          const lazy = Object.keys(chunks).filter((path) =>
            Object.keys(chunks[path].inputs).some((name) => input.test(name))
          );
          assert.equal(lazy.length, 1, `${input}: lazy chunk`);
          visit(lazy[0]);
        }
      download[id][library] = [...loaded].reduce(
        (sum, path) => sum + sizes.get(path)!,
        0
      );
    }
  }
  download.css = {};
  for (const [library, specifier] of [
    ['words', '@pierre/words/styles.css'],
    ['streamdown', 'streamdown/styles.css'],
  ])
    download.css[library] = Bun.gzipSync(
      await Bun.file(Bun.resolveSync(specifier, directory)).bytes(),
      { level: 9 }
    ).length;

  return { download, downloadRun };
}

/** Keep the standalone and full benchmark's download comparison identical. */
export function printDownload(download: DownloadReport['download']): void {
  console.log('Download, gzip KB');
  console.table(
    Object.fromEntries(
      Object.entries(download).map(([id, sizes]) => [
        id,
        Object.fromEntries(
          Object.entries(sizes).map(([library, bytes]) => [
            library,
            (bytes / 1000).toFixed(1),
          ])
        ),
      ])
    )
  );
}

/** Refresh download evidence while retaining the captured browser timing runs. */
async function writeDownloadDocs(report: DownloadReport): Promise<void> {
  const docs = join(directory, '../../../../apps/docs/public/words');
  const summaryPath = join(docs, 'benchmark.json');
  const rawPath = join(docs, 'benchmark-raw.json');
  const summary = (await Bun.file(summaryPath).json()) as {
    browser: Record<string, unknown>;
  };
  const raw = (await Bun.file(rawPath).json()) as Record<string, unknown>;
  Object.assign(summary.browser, report);
  Object.assign(raw, report);
  await Bun.write(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  await Bun.write(rawPath, JSON.stringify(raw, null, 2) + '\n');
}

if (import.meta.main) {
  const { values: flags } = parseArgs({
    options: {
      json: { type: 'string' },
      docs: { type: 'boolean', default: false },
    },
  });
  const report = await measureDownload();
  console.log(report.downloadRun);
  printDownload(report.download);
  if (flags.json != null)
    await Bun.write(flags.json, JSON.stringify(report, null, 2) + '\n');
  if (flags.docs) await writeDownloadDocs(report);
}
