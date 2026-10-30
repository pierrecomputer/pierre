import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';

import { environmentMetadata, sha256 } from '../environment.ts';

export const packageDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..'
);

/** Preserve partial runs without risking truncated JSON after interruption. */
export function save(path: string, value: unknown) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
}

export function newDirectory(path: string) {
  if (existsSync(path))
    throw new Error(`Output already exists: ${path}; choose a new directory`);
  mkdirSync(path, { recursive: true });
  return path;
}

/** Keep manifest keys portable while resolving filesystem paths natively. */
export function hashTree(path: string) {
  const files: Record<string, string> = {};
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(path, relative), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) files[name] = sha256(join(path, name));
    }
  };
  visit('');
  return files;
}

/**
 * The published html entry imports `@pierre/words` by name, which would resolve
 * to the live workspace instead of the capture. Bundle the captured html source
 * against the captured glue into one self-contained module instead.
 */
async function bundleHtml(output: string) {
  const source = join(output, 'html');
  cpSync(join(packageDirectory, 'html'), source, { recursive: true });
  const renderPath = join(source, 'render.ts');
  const render = readFileSync(renderPath, 'utf8');
  const occurrences = render.split("'@pierre/words'").length - 1;
  if (occurrences < 1)
    throw new Error('html/render.ts no longer imports @pierre/words');
  writeFileSync(
    renderPath,
    render.replaceAll("'@pierre/words'", "'../core.js'")
  );
  writeFileSync(
    join(source, 'lab-entry.ts'),
    "export * from '../core.js';\nexport { createHtmlRenderer } from './render';\n"
  );
  await build({
    config: false,
    cwd: packageDirectory,
    entry: { html: join(source, 'lab-entry.ts') },
    outDir: output,
    format: 'esm',
    platform: 'neutral',
    target: 'es2023',
    dts: false,
    clean: false,
    minify: false,
    sourcemap: false,
    hash: false,
    treeshake: true,
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
  });
  const bundle = readFileSync(join(output, 'html.mjs'), 'utf8');
  if (/^\s*import\s/m.test(bundle))
    throw new Error('Captured html bundle still has external imports');
}

/** Freeze the core module, html layer, sources, and identity without modifying dist. */
export async function capture(output: string) {
  newDirectory(output);
  for (const name of ['core.js', 'md.wasm'])
    cpSync(join(packageDirectory, 'dist', name), join(output, name));
  cpSync(join(packageDirectory, 'src'), join(output, 'src'), {
    recursive: true,
  });
  mkdirSync(join(output, 'scripts'));
  cpSync(
    join(packageDirectory, 'scripts/build.ts'),
    join(output, 'scripts/build.ts')
  );
  await bundleHtml(output);
  const manifest = {
    format: 'words-lab-capture',
    schemaVersion: 2,
    created: new Date().toISOString(),
    artifacts: hashTree(output),
    environment: environmentMetadata(),
  };
  save(join(output, 'capture.json'), manifest);
  return { directory: output, manifest };
}

export function loadCapture(path: string) {
  const directory = resolve(path);
  const manifest = JSON.parse(
    readFileSync(join(directory, 'capture.json'), 'utf8')
  );
  if (manifest.format !== 'words-lab-capture' || manifest.schemaVersion !== 2)
    throw new Error(
      `Not a words lab capture (schema 2): ${directory}; recapture with the current lab`
    );
  for (const [name, hash] of Object.entries(manifest.artifacts))
    if (sha256(join(directory, name)) !== hash)
      throw new Error(`Capture changed: ${join(directory, name)}`);
  for (const name of [
    'core.js',
    'html.mjs',
    'md.wasm',
    'src/md.wat',
    'html/render.ts',
    'scripts/build.ts',
  ])
    if (manifest.artifacts[name] == null)
      throw new Error(`Capture missing ${name}`);
  return { directory, manifest };
}
