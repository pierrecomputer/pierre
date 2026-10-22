// Build the PGO training corpus: real source files for each language, found
// on this machine and kept apart from the benchmark inputs, so profiles are
// not trained on what the benchmark measures. Languages with no files on
// disk fall back to their test sample, and target/train/sources.json records
// which ones did.
//
// Writes target/train/corpus.<lang> (about 256 KiB each, any language alias as
// the extension) and target/train/sources.json.
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { samples } from '../../test/_samples';

const genUrl = new URL('../gen/', import.meta.url);
const trainDir = new URL('../target/train/', import.meta.url).pathname;
const languages: Record<string, number> = JSON.parse(
  readFileSync(new URL('languages.json', genUrl), 'utf8')
);

const repo = new URL('../../../../', import.meta.url).pathname;
const roots = [
  repo,
  join(homedir(), '.cargo/registry/src'),
  '/opt/homebrew',
  '/usr/include',
  '/usr/share',
  '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include',
  join(homedir(), 'Developer'),
];
// Never train on the benchmark inputs or generated outputs.
const skipDirs = new Set([
  '.git',
  'gen',
  'fixtures',
  'dist',
  '.next',
  'target',
  'node_modules',
]);

const BUDGET = 256 * 1024;
const MAX_FILE = 64 * 1024;
const MIN_FILE = 512;
const MAX_VISITS = 6_000_000;

// One bucket per language id; any alias works as a file extension.
const byExt = new Map<string, number>();
for (const [name, id] of Object.entries(languages)) {
  if (id !== 0) byExt.set(name.toLowerCase(), id);
}
const buckets = new Map<
  number,
  { parts: Buffer[]; bytes: number; files: number }
>();
const canonical = new Map<number, string>();
for (const [name, id] of Object.entries(languages)) {
  if (id !== 0 && !canonical.has(id)) canonical.set(id, name);
}
for (const name of Object.keys(samples)) canonical.set(languages[name], name);

let visits = 0;
function walk(dir: string, depth: number): void {
  if (visits > MAX_VISITS || depth > 14) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (++visits > MAX_VISITS) return;
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!skipDirs.has(name) && !name.startsWith('.')) walk(path, depth + 1);
      continue;
    }
    const dot = name.lastIndexOf('.');
    const ext = (dot === -1 ? name : name.slice(dot + 1)).toLowerCase();
    const id = byExt.get(ext);
    if (id === undefined || st.size < MIN_FILE || st.size > MAX_FILE) continue;
    const bucket = buckets.get(id) ?? { parts: [], bytes: 0, files: 0 };
    if (bucket.bytes >= BUDGET) continue;
    const bytes = readFileSync(path);
    // Text only: skip binaries (.wasm shares the `wat` aliases) and
    // minified files.
    if (
      bytes.includes(0) ||
      bytes.length / (bytes.filter((b) => b === 10).length + 1) > 400
    ) {
      continue;
    }
    bucket.parts.push(bytes);
    bucket.bytes += bytes.length;
    bucket.files++;
    buckets.set(id, bucket);
  }
}
for (const root of roots) walk(root, 0);

/** Add `path` to its language's bucket if it is a usable text file. */
function take(id: number, path: string): void {
  const bucket = buckets.get(id) ?? { parts: [], bytes: 0, files: 0 };
  if (bucket.bytes >= BUDGET) return;
  const bytes = readFileSync(path);
  if (
    bytes.includes(0) ||
    bytes.length / (bytes.filter((b) => b === 10).length + 1) > 400
  ) {
    return;
  }
  bucket.parts.push(bytes);
  bucket.bytes += bytes.length;
  bucket.files++;
  buckets.set(id, bucket);
}

// Second pass for languages still short of files: a targeted `find` for
// their extensions only, which also searches node_modules.
const short = [...byExt].filter(
  ([, id]) => (buckets.get(id)?.bytes ?? 0) < 16 * 1024
);
if (short.length > 0) {
  const names = short.flatMap(([ext]) => ['-o', '-iname', `*.${ext}`]).slice(1);
  const found = spawnSync(
    'find',
    [
      ...roots,
      '-type',
      'f',
      '-size',
      '+1k',
      '-size',
      '-64k',
      '(',
      ...names,
      ')',
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  ).stdout.split('\n');
  for (const path of found) {
    if (path === '' || path.includes('/gen/') || path.includes('/fixtures/'))
      continue;
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    const id = byExt.get(ext);
    if (id !== undefined) take(id, path);
  }
}

rmSync(trainDir, { recursive: true, force: true });
mkdirSync(trainDir, { recursive: true });
const sources: Record<string, string> = {};
for (const [id, name] of canonical) {
  const bucket = buckets.get(id);
  if (bucket !== undefined && bucket.bytes >= 16 * 1024) {
    writeFileSync(
      join(trainDir, `corpus.${name}`),
      Buffer.concat(bucket.parts)
    );
    sources[name] =
      `${bucket.files} files, ${Math.round(bucket.bytes / 1024)} KiB`;
  } else if (name in samples) {
    const code = samples[name].code;
    writeFileSync(
      join(trainDir, `corpus.${name}`),
      code.repeat(Math.ceil(BUDGET / code.length))
    );
    sources[name] = 'test sample (no files on disk)';
  }
}
writeFileSync(
  join(trainDir, 'sources.json'),
  JSON.stringify(sources, null, 2) + '\n'
);
const fallback = Object.entries(sources).filter(([, s]) =>
  s.startsWith('test sample')
);
console.log(
  `train corpus: ${Object.keys(sources).length} languages, ${fallback.length} from test samples: ${fallback.map(([n]) => n).join(', ')}`
);
