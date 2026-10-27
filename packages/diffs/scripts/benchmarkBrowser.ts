// Render benchmark in real Chromium: serves a package root's built library
// through the e2e Vite config, opens test/e2e/fixtures/benchmark.html and runs
// its cases. `--root` points at another copy of the package (an old build to
// compare against); it needs a built `dist` and the fixture page.
//
//   moonx diffs:benchmark-browser -- [--root <package dir>] [--port 4185]
//                                    [--runs 5] [--warmup-runs 1]
//                                    [--only <substring>] [--json]

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

interface Config {
  root: string;
  port: number;
  runs: number;
  warmupRuns: number;
  only: string | undefined;
  outputJson: boolean;
}

interface CaseResult {
  name: string;
  runs: number;
  syncMs: number;
  frameMs: number;
}

// What test/e2e/fixtures/benchmark.html puts on its window.
declare global {
  interface Window {
    __bench?: {
      cases: string[];
      run(name: string, runs: number, warmupRuns: number): Promise<CaseResult>;
    };
    __benchReady?: boolean;
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    root: process.cwd(),
    port: 4185,
    runs: 5,
    warmupRuns: 1,
    only: undefined,
    outputJson: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value == null) throw new Error(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case '--root':
        config.root = resolve(next());
        break;
      case '--port':
        config.port = Number(next());
        break;
      case '--runs':
        config.runs = Number(next());
        break;
      case '--warmup-runs':
        config.warmupRuns = Number(next());
        break;
      case '--only':
        config.only = next();
        break;
      case '--json':
        config.outputJson = true;
        break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }
  return config;
}

// Starts the e2e Vite server for `root` and resolves once it answers.
async function startServer(root: string, port: number): Promise<() => void> {
  const server = spawn(
    resolve(root, 'node_modules/.bin/vite'),
    ['--config', 'test/e2e/vite.config.ts'],
    {
      cwd: root,
      env: { ...process.env, DIFFS_E2E_PORT: String(port) },
      stdio: ['ignore', 'ignore', 'inherit'],
    }
  );
  const url = `http://127.0.0.1:${port}/test/e2e/fixtures/benchmark.html`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) break;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return () => {
    server.kill();
  };
}

function printTable(results: CaseResult[]): void {
  const width = Math.max(...results.map((result) => result.name.length), 8);
  console.log(
    `${'case'.padEnd(width)}  ${'sync ms'.padStart(9)}  ${'frame ms'.padStart(9)}`
  );
  for (const result of results) {
    console.log(
      `${result.name.padEnd(width)}  ${result.syncMs.toFixed(2).padStart(9)}  ${result.frameMs.toFixed(2).padStart(9)}`
    );
  }
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const stopServer = await startServer(config.root, config.port);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
    });
    page.on('pageerror', (error) => {
      console.error(`[page] ${error.message}`);
    });
    await page.goto(
      `http://127.0.0.1:${config.port}/test/e2e/fixtures/benchmark.html`
    );
    await page.waitForFunction(() => window.__benchReady === true, undefined, {
      timeout: 60_000,
    });
    const names: string[] = await page.evaluate(() => {
      const bench = window.__bench;
      if (bench == null) throw new Error('the benchmark page is not ready');
      return bench.cases;
    });
    const selected =
      config.only == null
        ? names
        : names.filter((name) => name.includes(config.only!));
    const results: CaseResult[] = [];
    for (const name of selected) {
      const result: CaseResult = await page.evaluate(
        ([name, runs, warmupRuns]) => {
          const bench = window.__bench;
          if (bench == null) throw new Error('the benchmark page is not ready');
          return bench.run(name, runs, warmupRuns);
        },
        [name, config.runs, config.warmupRuns] as const
      );
      results.push(result);
      if (!config.outputJson) {
        console.error(
          `${name.padEnd(40)} sync ${result.syncMs.toFixed(2).padStart(8)} ms  frame ${result.frameMs.toFixed(2).padStart(8)} ms`
        );
      }
    }
    if (config.outputJson) {
      console.log(
        JSON.stringify(
          {
            benchmark: 'render-browser',
            config,
            measurement: { environment: 'chromium', highlighter: 'highlights' },
            results,
          },
          null,
          2
        )
      );
    } else {
      console.log('');
      console.log(
        `Render benchmark (Chromium, milliseconds) root=${config.root} runs=${config.runs}`
      );
      console.log('');
      printTable(results);
    }
  } finally {
    await browser.close();
    stopServer();
  }
}

await main();
