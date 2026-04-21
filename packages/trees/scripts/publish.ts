import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
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
// Run from `packages/trees`:
//   bun run publish-package -- --dry-run
//   bun run publish-package -- --tag=beta
//   bun run publish-package -- --tag=latest --promote-latest --tag-release

interface CliFlags {
  dryRun: boolean;
  tag: string;
  promoteLatest: boolean;
  tagRelease: boolean;
  releaseBranch: string | null;
  allowDirty: boolean;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = {
    dryRun: false,
    tag: 'beta',
    promoteLatest: false,
    tagRelease: false,
    releaseBranch: null,
    allowDirty: false,
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
    } else if (arg.startsWith('--release-branch=')) {
      flags.releaseBranch = arg.slice('--release-branch='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return flags;
}

function run(
  cmd: string,
  args: readonly string[],
  options: { cwd?: string; inherit?: boolean } = {}
): string {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: options.inherit === true ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const stdout = result.stdout?.toString() ?? '';
    const stderr = result.stderr?.toString() ?? '';
    throw new Error(
      `${cmd} ${args.join(' ')} exited with ${result.status}\n${stdout}\n${stderr}`
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

  const whoami = run('bun', ['pm', 'whoami']).trim();
  if (whoami.length === 0) {
    throw new Error('bun pm whoami returned empty — log in to npm first.');
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

// Builds trees' dist (the V3 gate runs inside the build script itself) so the
// tarball we pack next contains up-to-date output with no path-store leaks.
function buildTrees(): void {
  console.log('[publish] building @pierre/trees');
  run('bun', ['run', 'build'], { cwd: packageRoot(), inherit: true });
}

// Asks bun to produce the same tarball it would upload to npm. bun's pack
// already rewrites `workspace:*` dependencies to their resolved versions.
function packTarball(destination: string, cwd = packageRoot()): string {
  console.log(`[publish] packing tarball into ${destination}`);
  mkdirSync(destination, { recursive: true });
  run('bun', ['pm', 'pack', '--destination', destination], {
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

// Publish the final tarball, not the source package directory. `--ignore-scripts`
// prevents package lifecycle hooks from rebuilding the already-verified payload.
function publish(tarballPath: string, tag: string): void {
  console.log(`[publish] bun publish --tag=${tag} ${tarballPath}`);
  run('bun', ['publish', '--ignore-scripts', '--tag', tag, tarballPath], {
    inherit: true,
  });
}

function dryRunPublish(tarballPath: string, tag: string): void {
  console.log(`[publish] bun publish --dry-run --tag=${tag} ${tarballPath}`);
  run(
    'bun',
    ['publish', '--dry-run', '--ignore-scripts', '--tag', tag, tarballPath],
    {
      inherit: true,
    }
  );
}

function promoteLatest(version: string): void {
  console.log(`[publish] promoting @pierre/trees@${version} to latest`);
  run('npm', ['dist-tag', 'add', `@pierre/trees@${version}`, 'latest'], {
    inherit: true,
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
    dryRunPublish(finalTarballPath, flags.tag);
    console.log('\n--- package.json diff ---');
    console.log(describeDiff(before, after));
    console.log('\n--- final tarball listing ---');
    run('tar', ['-tzf', finalTarballPath], { inherit: true });
    console.log(
      `\nDry-run complete. Final tarball: ${finalTarballPath}. Would publish to tag "${flags.tag}".`
    );
    return;
  }

  publish(finalTarballPath, flags.tag);

  if (flags.promoteLatest) {
    promoteLatest(version);
  }

  if (flags.tagRelease) {
    tagRelease(version);
  }

  console.log(
    `\n[publish] done — published @pierre/trees@${version} to ${flags.tag}`
  );
}

main();
