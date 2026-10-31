import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { arch, cpus, platform, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const parsers = [
  'words',
  'md4x-native',
  'md4x-wasm',
  'markdown-it',
] as const;
export const streamers = ['words-react', 'streamdown'] as const;
export type Engine = (typeof parsers)[number] | (typeof streamers)[number];

export const labels: Record<Engine, string> = {
  words: 'Words',
  'md4x-native': 'md4x native',
  'md4x-wasm': 'md4x Wasm',
  'markdown-it': 'markdown-it',
  'words-react': 'Words React',
  streamdown: 'Streamdown',
};

export function loadFixtures(filter?: string) {
  const directory = fileURLToPath(new URL('./fixtures/', import.meta.url));
  const fixtures = readdirSync(directory)
    .filter(
      (name) => name.endsWith('.md') && (filter == null || name === filter)
    )
    .map((name) => {
      const path = join(directory, name);
      const source = readFileSync(path, 'utf8');
      return { name, path, source, bytes: Buffer.byteLength(source) };
    })
    .sort((a, b) => a.bytes - b.bytes);
  assert.ok(fixtures.length > 0, `No fixtures match ${filter ?? '*.md'}`);
  return fixtures;
}

export function environment() {
  const versions: Record<string, string> = {};
  for (const name of ['md4x', 'markdown-it', 'streamdown', 'react', 'jsdom']) {
    try {
      let directory = dirname(fileURLToPath(import.meta.resolve(name)));
      for (;;) {
        try {
          const pkg = JSON.parse(
            readFileSync(join(directory, 'package.json'), 'utf8')
          ) as {
            name: string;
            version: string;
          };
          if (pkg.name === name) {
            versions[name] = pkg.version;
            break;
          }
        } catch {}
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    } catch {}
  }
  return {
    date: new Date().toISOString(),
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    memoryBytes: totalmem(),
    versions,
  };
}

export function unavailable(error: unknown): boolean {
  return [
    'ERR_MODULE_NOT_FOUND',
    'MODULE_NOT_FOUND',
    'ERR_DLOPEN_FAILED',
  ].includes((error as NodeJS.ErrnoException)?.code ?? '');
}

export async function loadParser(engine: (typeof parsers)[number]) {
  if (engine === 'words') {
    const { renderToHtml } = await import('@pierre/words');
    const decoder = new TextDecoder();
    return (source: string) => decoder.decode(renderToHtml(source));
  }
  if (engine === 'markdown-it') {
    const { default: MarkdownIt } = await import('markdown-it');
    const parser = new MarkdownIt({ html: true, linkify: true });
    return (source: string) => parser.render(source);
  }
  const specifier = engine === 'md4x-native' ? 'md4x/napi' : 'md4x/wasm';
  const parser = (await import(specifier)) as {
    init(): Promise<unknown>;
    renderToHtml(source: string): string;
  };
  await parser.init();
  return (source: string) => parser.renderToHtml(source);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export let lastResult: unknown;

export function measure(
  cases: { run(): unknown; cleanup?(): void }[],
  quick: boolean
) {
  const states = cases.map((entry) => ({
    ...entry,
    batch: 1,
    elapsed: 0,
    iterations: 0,
    samples: [] as number[],
  }));
  for (const warmup of [true, false]) {
    const budget = warmup ? (quick ? 20 : 200) : quick ? 50 : 1500;
    const minimum = warmup ? 3 : quick ? 3 : 20;
    for (const state of states) {
      state.elapsed = 0;
      state.iterations = 0;
    }
    for (let round = 0; ; round++) {
      let complete = true;
      for (let offset = 0; offset < states.length; offset++) {
        const state = states[(round + offset) % states.length];
        if (
          state.elapsed >= budget &&
          (warmup ? state.iterations : state.samples.length) >= minimum
        )
          continue;
        complete = false;
        const start = performance.now();
        let elapsed: number;
        try {
          for (let i = 0; i < state.batch; i++) lastResult = state.run();
        } finally {
          elapsed = performance.now() - start;
          state.cleanup?.();
          lastResult = undefined;
        }
        state.elapsed += performance.now() - start;
        state.iterations += state.batch;
        if (warmup && state.cleanup == null) {
          state.batch = Math.max(
            1,
            Math.min(
              state.batch * 2,
              Math.ceil((state.batch * 5) / Math.max(elapsed, 0.001))
            )
          );
        } else if (!warmup) {
          state.samples.push(elapsed / state.batch);
        }
      }
      if (complete) break;
    }
  }
  return states.map(({ samples, iterations }) => ({
    medianMs: median(samples),
    p95Ms: [...samples].sort((a, b) => a - b)[
      Math.ceil(samples.length * 0.95) - 1
    ],
    iterations,
    samplesMs: samples,
  }));
}
