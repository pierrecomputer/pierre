import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

// Fails if files under the target directory mention `@pierre/path-store`.
// By default it scans runtime and type files. `--all-text-files` broadens the
// scan for the final publish payload, where README/package metadata leaks matter
// too.
//
// Sourcemaps (`.map`) are intentionally excluded — they embed original source
// text including the pre-bundling `@pierre/path-store` import strings, but
// nothing resolves those at runtime.
const CODE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.d.ts',
  '.d.mts',
  '.d.cts',
]);

interface CliArgs {
  dir: string;
  scanAllTextFiles: boolean;
}

function isCodeFile(name: string): boolean {
  for (const extension of CODE_EXTENSIONS) {
    if (name.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

function shouldScanFile(name: string, scanAllTextFiles: boolean): boolean {
  if (name.endsWith('.map')) {
    return false;
  }
  return scanAllTextFiles || isCodeFile(name);
}

async function collectFiles(
  dir: string,
  scanAllTextFiles: boolean
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, scanAllTextFiles)));
    } else if (entry.isFile() && shouldScanFile(entry.name, scanAllTextFiles)) {
      files.push(full);
    }
  }
  return files;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let dir = 'dist';
  let scanAllTextFiles = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dir') {
      const next = argv[index + 1];
      if (next == null) {
        throw new Error('--dir requires a path argument');
      }
      dir = next;
      index += 1;
    } else if (arg === '--all-text-files') {
      scanAllTextFiles = true;
    }
  }
  return { dir, scanAllTextFiles };
}

const NEEDLE = '@pierre/path-store';

async function main(): Promise<void> {
  const { dir, scanAllTextFiles } = parseArgs(process.argv.slice(2));
  const absDir = resolve(process.cwd(), dir);
  const files = await collectFiles(absDir, scanAllTextFiles);
  const offenders: string[] = [];
  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    if (contents.includes(NEEDLE)) {
      offenders.push(relative(process.cwd(), file));
    }
  }

  if (offenders.length > 0) {
    console.error(
      `assert-no-path-store: ${offenders.length} file(s) under ${dir} still reference "${NEEDLE}":`
    );
    for (const offender of offenders) {
      console.error(`  ${offender}`);
    }
    process.exit(1);
  }
}

await main();
