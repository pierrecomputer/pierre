import { spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

// End-to-end release pipeline for `@pierre/trees`. The load-bearing step is
// repacking the generated tarball after deleting the internal `@pierre/path-store`
// workspace dependency, so the tarball we rehearse is the tarball we publish.
//
//   moonx trees:publish -- --dry-run
//   moonx trees:publish -- --tag=beta
//   moonx trees:publish -- --tag=latest --promote-latest --tag-release

export interface CliFlags {
  dryRun: boolean;
  tag: string;
  promoteLatest: boolean;
  tagRelease: boolean;
  releaseBranch: string | null;
  allowDirty: boolean;
  otp: string | null;
}

export function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = {
    dryRun: false,
    tag: 'beta',
    promoteLatest: false,
    tagRelease: false,
    releaseBranch: null,
    allowDirty: false,
    otp: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--promote-latest') {
      flags.promoteLatest = true;
    } else if (arg === '--tag-release') {
      flags.tagRelease = true;
    } else if (arg === '--dirty') {
      flags.allowDirty = true;
    } else if (arg.startsWith('--tag=')) {
      flags.tag = arg.slice('--tag='.length);
    } else if (arg === '--otp') {
      const otp = argv[index + 1];
      if (otp === undefined || otp.length === 0 || otp.startsWith('--')) {
        throw new Error('--otp requires a one-time password');
      }
      flags.otp = otp;
      index += 1;
    } else if (arg.startsWith('--otp=')) {
      const otp = arg.slice('--otp='.length);
      if (otp.length === 0) {
        throw new Error('--otp requires a one-time password');
      }
      flags.otp = otp;
    } else if (arg.startsWith('--release-branch=')) {
      flags.releaseBranch = arg.slice('--release-branch='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return flags;
}

// Builds pnpm arguments with OTP last so auth details stay isolated from the
// rest of the release command and can be redacted consistently in logs.
function withOtp(args: string[], otp: string | null): string[] {
  if (otp === null) {
    return args;
  }
  return [...args, '--otp', otp];
}

export function publishArgs(
  tarballPath: string,
  tag: string,
  otp: string | null
): string[] {
  return withOtp(
    ['publish', tarballPath, '--tag', tag, '--no-git-checks'],
    otp
  );
}

export function dryRunPublishArgs(
  tarballPath: string,
  tag: string,
  otp: string | null
): string[] {
  return withOtp(
    ['publish', tarballPath, '--dry-run', '--tag', tag, '--no-git-checks'],
    otp
  );
}

export function distTagAddArgs(version: string, otp: string | null): string[] {
  return withOtp(
    ['dist-tag', 'add', `@pierre/trees@${version}`, 'latest'],
    otp
  );
}

export function redactOtp(args: readonly string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;

  for (const arg of args) {
    if (redactNext) {
      redacted.push('<redacted>');
      redactNext = false;
      continue;
    }

    if (arg === '--otp') {
      redacted.push(arg);
      redactNext = true;
      continue;
    }

    if (arg.startsWith('--otp=')) {
      redacted.push('--otp=<redacted>');
      continue;
    }

    redacted.push(arg);
  }

  return redacted;
}

type StdioOption = 'inherit' | [number, number, number];

// moon captures task stdio, so child processes do not always see a TTY even
// when a maintainer ran `moonx` from an interactive terminal. Publish-time npm
// 2FA needs a real terminal for retry prompts and web-based authentication.
function openTerminalStdio(): [number, number, number] | null {
  let input: number | null = null;
  let output: number | null = null;
  let error: number | null = null;

  try {
    input = openSync('/dev/tty', 'r');
    output = openSync('/dev/tty', 'w');
    error = openSync('/dev/tty', 'w');
    return [input, output, error];
  } catch {
    for (const fd of [input, output, error]) {
      if (fd !== null) {
        closeSync(fd);
      }
    }
    return null;
  }
}

function closeTerminalStdio(
  stdio: StdioOption | ['ignore', 'pipe', 'pipe']
): void {
  if (Array.isArray(stdio)) {
    for (const fd of stdio) {
      if (typeof fd === 'number') {
        closeSync(fd);
      }
    }
  }
}

function resolveStdio(options: {
  inherit?: boolean;
  preferTerminal?: boolean;
}): StdioOption | ['ignore', 'pipe', 'pipe'] {
  if (options.preferTerminal === true) {
    const terminalStdio = openTerminalStdio();
    if (terminalStdio !== null) {
      return terminalStdio;
    }
  }

  return options.inherit === true ? 'inherit' : ['ignore', 'pipe', 'pipe'];
}

function run(
  cmd: string,
  args: readonly string[],
  options: { cwd?: string; inherit?: boolean; preferTerminal?: boolean } = {}
): string {
  const stdio = resolveStdio(options);
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio,
    encoding: 'utf8',
  });
  closeTerminalStdio(stdio);
  if (result.status !== 0) {
    const stdout = result.stdout?.toString() ?? '';
    const stderr = result.stderr?.toString() ?? '';
    throw new Error(
      `${cmd} ${redactOtp(args).join(' ')} exited with ${result.status}\n${stdout}\n${stderr}`
    );
  }
  return result.stdout?.toString() ?? '';
}

// Confirms the working tree is clean before running a publish so release
// artifacts can be reproduced from the committed source.
function preflight(flags: CliFlags): void {
  if (!flags.allowDirty) {
    const status = run('git', ['status', '--porcelain']);
    if (status.trim().length > 0) {
      throw new Error(
        `Working tree is dirty. Commit/stash changes or pass --dirty.\n${status}`
      );
    }
  }

  const whoami = run('pnpm', ['whoami']).trim();
  if (whoami.length === 0) {
    throw new Error('pnpm whoami returned empty — run pnpm login first.');
  }
  console.log(`npm user: ${whoami}`);

  if (flags.releaseBranch != null) {
    const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (branch !== flags.releaseBranch) {
      throw new Error(
        `Expected to be on branch "${flags.releaseBranch}" but HEAD is "${branch}".`
      );
    }
  }
}

function packageRoot(): string {
  return resolve(import.meta.dir, '..');
}

// Builds trees' dist (the V3 gate runs inside the build task itself) so the
// tarball we pack next contains up-to-date output with no path-store leaks.
function buildTrees(): void {
  console.log('[publish] building @pierre/trees');
  run('moon', ['run', 'trees:build'], { cwd: packageRoot(), inherit: true });
}

// Asks pnpm to produce the same tarball it would upload to npm. pnpm pack
// rewrites `workspace:*` dependencies to their resolved versions.
function packTarball(destination: string, cwd = packageRoot()): string {
  console.log(`[publish] packing tarball into ${destination}`);
  mkdirSync(destination, { recursive: true });
  run('pnpm', ['pack', '--pack-destination', destination], {
    cwd,
    inherit: true,
  });
  const entries = readdirSync(destination).filter((name) =>
    name.endsWith('.tgz')
  );
  if (entries.length !== 1) {
    throw new Error(
      `expected exactly one .tgz in ${destination}, found ${entries.length}`
    );
  }
  return join(destination, entries[0] ?? '');
}

function untar(tarballPath: string, into: string): void {
  run('tar', ['-xzf', tarballPath, '-C', into]);
}

function stripPublishOnlyScripts(pkg: {
  scripts?: Record<string, string>;
}): void {
  if (pkg.scripts == null) {
    return;
  }
  delete pkg.scripts['assert:safe-publish'];
  delete pkg.scripts['publish-package'];
  delete pkg.scripts.prepublishOnly;
  if (Object.keys(pkg.scripts).length === 0) {
    delete pkg.scripts;
  }
}

// Strips repo-only metadata from the unpacked package. Consumers should never
// transitively pull in a private workspace package, and the final tarball should
// not contain lifecycle scripts that try to rebuild from missing source files.
function mutatePackageJson(packageDir: string): {
  before: string;
  after: string;
} {
  const pkgPath = join(packageDir, 'package.json');
  const before = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(before);
  if (pkg.dependencies != null) {
    delete pkg.dependencies['@pierre/path-store'];
  }
  stripPublishOnlyScripts(pkg);
  const serialized = `${JSON.stringify(pkg, null, 2)}\n`;
  if (serialized.includes('@pierre/path-store')) {
    throw new Error(
      'package.json still references @pierre/path-store after mutation — another field is leaking.'
    );
  }
  writeFileSync(pkgPath, serialized);
  return { before, after: serialized };
}

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function assertNoBuildInfoFiles(packageDir: string): void {
  const offenders = collectFiles(packageDir)
    .filter((file) => file.endsWith('.tsbuildinfo'))
    .map((file) => relative(process.cwd(), file));
  if (offenders.length > 0) {
    throw new Error(
      `TypeScript build-info files leaked into the publish payload:\n${offenders.join('\n')}`
    );
  }
}

// Belt-and-suspenders: run the V3 gate against the final publish payload and
// scan all shipped text files, excluding sourcemaps, for package references.
function assertPublishPayload(packageDir: string): void {
  run('bun', [
    join(packageRoot(), 'scripts', 'assert-no-path-store.ts'),
    '--dir',
    packageDir,
    '--all-text-files',
  ]);
  assertNoBuildInfoFiles(packageDir);
}

function describeDiff(before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const removed = beforeLines.filter((line) => !afterLines.includes(line));
  const added = afterLines.filter((line) => !beforeLines.includes(line));
  const removedText = removed.map((line) => `- ${line}`).join('\n');
  const addedText = added.map((line) => `+ ${line}`).join('\n');
  return `${removedText}\n${addedText}`.trim();
}

function verifyTarball(tarballPath: string, workDir: string): void {
  const verifyRoot = join(workDir, 'verify');
  mkdirSync(verifyRoot, { recursive: true });
  untar(tarballPath, verifyRoot);
  assertPublishPayload(join(verifyRoot, 'package'));
}

// Publish the final tarball, not the source package directory. The final tarball
// has repo-only lifecycle scripts removed before it reaches pnpm publish.
function publish(tarballPath: string, tag: string, otp: string | null): void {
  const args = publishArgs(tarballPath, tag, otp);
  console.log(`[publish] pnpm ${redactOtp(args).join(' ')}`);
  run('pnpm', args, {
    inherit: true,
    preferTerminal: true,
  });
}

function dryRunPublish(
  tarballPath: string,
  tag: string,
  otp: string | null
): void {
  const args = dryRunPublishArgs(tarballPath, tag, otp);
  console.log(`[publish] pnpm ${redactOtp(args).join(' ')}`);
  run('pnpm', args, {
    inherit: true,
  });
}

function promoteLatest(version: string, otp: string | null): void {
  console.log(`[publish] promoting @pierre/trees@${version} to latest`);
  const args = distTagAddArgs(version, otp);
  console.log(`[publish] pnpm ${redactOtp(args).join(' ')}`);
  run('pnpm', args, {
    inherit: true,
    preferTerminal: true,
  });
}

function tagRelease(version: string): void {
  const tagName = `@pierre/trees@${version}`;
  console.log(`[publish] git tag ${tagName}`);
  run('git', ['tag', '-a', tagName, '-m', tagName], { inherit: true });
  run('git', ['push', 'origin', tagName], { inherit: true });
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));

  preflight(flags);
  buildTrees();

  const workDir = mkdtempSync(join(tmpdir(), 'pierre-trees-publish-'));
  console.log(`[publish] workdir: ${workDir}`);

  const sourceTarballPath = packTarball(join(workDir, 'source'));

  const unpackedRoot = join(workDir, 'unpacked');
  mkdirSync(unpackedRoot, { recursive: true });
  untar(sourceTarballPath, unpackedRoot);
  const packageDir = join(unpackedRoot, 'package');

  const { before, after } = mutatePackageJson(packageDir);
  assertPublishPayload(packageDir);

  const finalTarballPath = packTarball(join(workDir, 'final'), packageDir);
  verifyTarball(finalTarballPath, workDir);

  const version = JSON.parse(after).version;

  if (flags.dryRun) {
    dryRunPublish(finalTarballPath, flags.tag, flags.otp);
    console.log('\n--- package.json diff ---');
    console.log(describeDiff(before, after));
    console.log('\n--- final tarball listing ---');
    run('tar', ['-tzf', finalTarballPath], { inherit: true });
    console.log(
      `\nDry-run complete. Final tarball: ${finalTarballPath}. Would publish to tag "${flags.tag}".`
    );
    return;
  }

  publish(finalTarballPath, flags.tag, flags.otp);

  if (flags.promoteLatest) {
    promoteLatest(version, flags.otp);
  }

  if (flags.tagRelease) {
    tagRelease(version);
  }

  console.log(
    `\n[publish] done — published @pierre/trees@${version} to ${flags.tag}`
  );
}

if (import.meta.main) {
  main();
}
