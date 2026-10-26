import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { harnessDirectory } from './environment.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--skip-browser'))
  throw new Error('Usage: bench-setup -- [--skip-browser]');
const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
  cwd: harnessDirectory,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(
    `Benchmark dependency installation failed (${result.status}).`
  );
if (!args.includes('--skip-browser')) {
  const require = createRequire(join(harnessDirectory, 'package.json'));
  const { install, Browser, detectBrowserPlatform } = await import(
    require.resolve('@puppeteer/browsers')
  );
  if (!detectBrowserPlatform())
    throw new Error(
      'No pinned Chrome download for this platform. Re-run with --skip-browser and set WORDS_BENCH_BROWSER to a compatible Chrome executable.'
    );
  const { benchmark } = JSON.parse(
    readFileSync(join(harnessDirectory, 'package.json'), 'utf8')
  );
  const cacheDir = join(harnessDirectory, 'browsers');
  mkdirSync(cacheDir, { recursive: true });
  let installed;
  try {
    installed = await install({
      browser: Browser.CHROME,
      buildId: benchmark.chrome,
      cacheDir,
    });
  } catch (error) {
    throw new Error(
      'Pinned Chrome installation failed. Check network/system support, or run --skip-browser and set WORDS_BENCH_BROWSER to a compatible Chrome executable.',
      { cause: error }
    );
  }
  writeFileSync(
    join(harnessDirectory, '.browser.json'),
    JSON.stringify(
      { buildId: benchmark.chrome, executablePath: installed.executablePath },
      null,
      2
    ) + '\n'
  );
  console.log(`Pinned Chrome ${benchmark.chrome}: ${installed.executablePath}`);
}
console.log('Words benchmark tools ready. Run moon run words:bench-quick.');
