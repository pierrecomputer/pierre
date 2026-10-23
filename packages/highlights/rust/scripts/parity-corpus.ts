// Build the parity corpus for the native lexers: real source files for each
// language, found on this machine (node_modules included), kept as separate
// files so every file starts from a fresh lexer state. Each language also
// gets its test sample. Native lexers must give the same records as the
// translated ones on every file (scripts/native-check.sh).
//
// Writes <out>/<lang>/<n>.<lang> (up to about 2 MiB per language) and
// <out>/sources.json; <out> is target/parity unless given as an argument.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { samples } from '../../test/_samples';

const genUrl = new URL('../gen/', import.meta.url);
const parityDir =
  process.argv[2] ?? new URL('../target/parity/', import.meta.url).pathname;
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
const BUDGET = 2 * 1024 * 1024;
const MAX_FILES = 600;
const MAX_FILE = 256 * 1024;

// The canonical name for each language id, and every alias as an extension.
const canonical = new Map<number, string>();
for (const [name, id] of Object.entries(languages)) {
  if (id !== 0 && !canonical.has(id)) canonical.set(id, name);
}
for (const name of Object.keys(samples)) canonical.set(languages[name], name);
const byExt = new Map<string, number>();
for (const [name, id] of Object.entries(languages)) {
  if (id !== 0) byExt.set(name.toLowerCase(), id);
}
// Languages recognized by file name rather than extension.
const byName = new Map<string, string>([
  ['dockerfile', 'dockerfile'],
  ['containerfile', 'dockerfile'],
  ['makefile', 'makefile'],
  ['gnumakefile', 'makefile'],
  ['cmakelists.txt', 'cmake'],
]);

/** The language id for `path`, by file name, then extension. */
function languageOf(path: string): number | undefined {
  const name = basename(path).toLowerCase();
  const named = byName.get(name);
  if (named !== undefined) return languages[named];
  const dot = name.lastIndexOf('.');
  return dot === -1 ? undefined : byExt.get(name.slice(dot + 1));
}

const names = [
  ...[...byExt.keys()].map((ext) => `*.${ext}`),
  ...byName.keys(),
].flatMap((pattern) => ['-o', '-iname', pattern]);
const found = spawnSync(
  'find',
  [
    ...roots,
    '(',
    '-name',
    '.git',
    '-o',
    '-name',
    'target',
    ')',
    '-prune',
    '-o',
    '-type',
    'f',
    '-size',
    '+63c',
    '(',
    ...names.slice(1),
    ')',
    '-print',
  ],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 }
).stdout.split('\n');

const buckets = new Map<number, { files: Buffer[]; bytes: number }>();
for (const path of found) {
  // Never the benchmark inputs or generated outputs.
  if (path === '' || /\/(gen|fixtures|dist)\//.test(path)) continue;
  const id = languageOf(path);
  if (id === undefined) continue;
  const bucket = buckets.get(id) ?? { files: [], bytes: 0 };
  if (bucket.bytes >= BUDGET || bucket.files.length >= MAX_FILES) continue;
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    continue;
  }
  // Text only: skip binaries (.wasm shares the `wat` aliases).
  if (bytes.length > MAX_FILE || bytes.includes(0)) continue;
  bucket.files.push(bytes);
  bucket.bytes += bytes.length;
  buckets.set(id, bucket);
}

rmSync(parityDir, { recursive: true, force: true });
const sources: Record<string, string> = {};
for (const [id, name] of canonical) {
  const dir = join(parityDir, name);
  mkdirSync(dir, { recursive: true });
  const bucket = buckets.get(id) ?? { files: [], bytes: 0 };
  bucket.files.forEach((bytes, i) =>
    writeFileSync(join(dir, `${i}.${name}`), bytes)
  );
  if (name in samples) {
    writeFileSync(join(dir, `sample.${name}`), samples[name].code);
  }
  sources[name] =
    `${bucket.files.length} files, ${Math.round(bucket.bytes / 1024)} KiB`;
}
writeFileSync(
  join(parityDir, 'sources.json'),
  JSON.stringify(sources, null, 2) + '\n'
);
const thin = Object.entries(sources).filter(([, s]) => s.startsWith('0 files'));
console.log(
  `parity corpus: ${Object.keys(sources).length} languages, ${thin.length} with only the test sample: ${thin.map(([n]) => n).join(', ')}`
);
