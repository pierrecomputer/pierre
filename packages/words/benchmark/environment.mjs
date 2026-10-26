import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const benchmarkDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryDirectory = resolve(benchmarkDirectory, '../../..');
export const harnessDirectory = join(benchmarkDirectory, 'harness');
export const harnessDependencies = join(harnessDirectory, 'node_modules');

/** Require the checked-in toolchain instead of whichever global CLI is on PATH. */
export function browserCommand() {
  const path = join(
    harnessDependencies,
    '.bin',
    process.platform === 'win32' ? 'agent-browser.cmd' : 'agent-browser'
  );
  if (!existsSync(path))
    throw new Error(
      'Benchmark tools are missing. Run moon run words:bench-setup first.'
    );
  return path;
}

/** Select the installed pinned browser or an explicitly recorded local override. */
export function browserPath() {
  if (process.env.WORDS_BENCH_BROWSER) {
    const path = resolve(process.env.WORDS_BENCH_BROWSER);
    if (!existsSync(path))
      throw new Error(`WORDS_BENCH_BROWSER does not exist: ${path}`);
    return path;
  }
  const marker = join(harnessDirectory, '.browser.json');
  if (existsSync(marker)) {
    const { executablePath } = JSON.parse(readFileSync(marker, 'utf8'));
    if (existsSync(executablePath)) return executablePath;
  }
  throw new Error(
    'Pinned Chrome is missing. Run moon run words:bench-setup, or set WORDS_BENCH_BROWSER to an existing Chrome executable.'
  );
}

export function browserArguments(session, args) {
  // Launch settings must be supplied only when opening; repeating them can reset
  // the CLI's remembered Chrome flags during a memory session.
  return [
    '--session',
    session,
    ...(args.includes('open') ? ['--executable-path', browserPath()] : []),
    ...args,
  ];
}

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Record machine, source, lockfile, and built bytes independently of timing. */
export function environmentMetadata({ browser = false } = {}) {
  const git = (...args) => {
    try {
      return execFileSync('git', args, {
        cwd: repositoryDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  };
  const files = {};
  const collect = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (statSync(path).isFile())
        files[path.slice(repositoryDirectory.length + 1)] = sha256(path);
    }
  };
  collect(join(repositoryDirectory, 'packages/words/dist'));
  collect(join(repositoryDirectory, 'packages/highlights/dist'));
  const manifest = JSON.parse(
    readFileSync(join(harnessDirectory, 'package.json'), 'utf8')
  );
  return {
    date: new Date().toISOString(),
    node: process.version,
    platform: platform(),
    architecture: arch(),
    osRelease: release(),
    cpu: cpus()[0]?.model ?? null,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    git: {
      commit: git('rev-parse', 'HEAD'),
      dirty: Boolean(git('status', '--porcelain')),
    },
    workspaceLockfileSha256: sha256(
      join(repositoryDirectory, 'pnpm-lock.yaml')
    ),
    toolchainSha256: sha256(join(repositoryDirectory, '.prototools')),
    driverHashes: Object.fromEntries(
      readdirSync(benchmarkDirectory)
        .filter((name) => /\.(mjs|ts|css)$/.test(name))
        .sort()
        .map((path) => [path, sha256(join(benchmarkDirectory, path))])
    ),
    harness: {
      dependencySpecifiers: manifest.dependencies,
      dependencies: Object.fromEntries(
        Object.keys(manifest.dependencies).map((name) => {
          const path = join(harnessDependencies, name, 'package.json');
          return [
            name,
            existsSync(path)
              ? JSON.parse(readFileSync(path, 'utf8')).version
              : null,
          ];
        })
      ),
      lockfileSha256: sha256(join(harnessDirectory, 'pnpm-lock.yaml')),
      pinnedChrome: manifest.benchmark.chrome,
    },
    ...(browser
      ? {
          browser: {
            executablePath: browserPath(),
            version: execFileSync(browserPath(), ['--version'], {
              encoding: 'utf8',
              timeout: 10000,
            }).trim(),
            override: Boolean(process.env.WORDS_BENCH_BROWSER),
            cliVersion: execFileSync(browserCommand(), ['--version'], {
              encoding: 'utf8',
            }).trim(),
          },
        }
      : {}),
    fixtureHashes: Object.fromEntries(
      [
        'fixtures.mjs',
        'fixtures/tiny.md',
        'fixtures/simd.md',
        'fixtures/gfm-spec.md',
      ].map((path) => [path, sha256(join(benchmarkDirectory, path))])
    ),
    builtFilesSha256: files,
  };
}
