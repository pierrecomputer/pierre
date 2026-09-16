import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { HighlightsHighlighter } from '../lib/highlighter';
import type { Theme } from '../lib/index';

export interface MemoryCase {
  name: string;
  mode: 'html' | 'tokens';
  fixture: string;
  repeat: number;
}

export interface MemoryRequest {
  engine: 'highlights' | 'shiki-js' | 'shiki-wasm';
  scenario: MemoryCase;
  highlights: string;
  shiki: string;
  wasm: string;
  theme: string;
}

interface MemoryReading extends NodeJS.MemoryUsage {
  peakRss: number;
  wasmBytes?: number;
}

export interface MemoryResult {
  runtime: string;
  baseline: MemoryReading;
  ready: MemoryReading;
  input: MemoryReading;
  firstCall: MemoryReading;
  holdingOutput: MemoryReading;
  releasedOutput: MemoryReading;
  inputBytes: number;
  lines: number;
  outputSize: number;
}

type Output = string | { tokens: { content: string }[][] };

// Exported references keep the engine, source, and result alive across GC.
export const retained: {
  highlighter?: unknown;
  input?: string;
  output?: Output;
} = {};

const request = JSON.parse(process.argv[2]) as MemoryRequest;
const { engine, scenario } = request;
let memory: WebAssembly.Memory | undefined;
let highlight: (input: string) => Output;

/** Collect temporary call frames and buffers across event-loop turns. */
async function collect(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    Bun.gc(true);
  }
}

/** Include native/Wasm costs via RSS; heap counters alone omit them. */
function readMemory(): MemoryReading {
  return {
    ...process.memoryUsage(),
    peakRss: process.resourceUsage().maxRSS * 1024,
    wasmBytes: memory?.buffer.byteLength,
  };
}

await collect();
const baseline = readMemory();
if (engine === 'highlights') {
  const { init } = (await import(
    request.highlights
  )) as typeof import('../lib/index');
  const highlighter = init(new WebAssembly.Module(readFileSync(request.wasm)));
  const theme = JSON.parse(readFileSync(request.theme, 'utf8')) as Theme;
  const options = { lang: 'ts' as const, theme };
  const decoder = new TextDecoder();
  retained.highlighter = highlighter;
  memory = (highlighter as HighlightsHighlighter).memory;
  highlight = (input) =>
    scenario.mode === 'tokens'
      ? highlighter.codeToTokens(input, options)
      : decoder.decode(highlighter.codeToHtml(input, options));
} else {
  const { createHighlighter, createJavaScriptRegexEngine } = (await import(
    request.shiki
  )) as typeof import('shiki');
  const highlighter = await createHighlighter({
    themes: ['github-dark'],
    langs: ['ts'],
    ...(engine === 'shiki-js' ? { engine: createJavaScriptRegexEngine() } : {}),
  });
  const options = {
    lang: 'ts' as const,
    theme: 'github-dark' as const,
    tokenizeMaxLineLength: 0,
    tokenizeTimeLimit: 0,
  };
  retained.highlighter = highlighter;
  highlight = (input) =>
    scenario.mode === 'tokens'
      ? highlighter.codeToTokens(input, options)
      : highlighter.codeToHtml(input, options);
}
await collect();
const ready = readMemory();
const input = readFileSync(scenario.fixture, 'utf8').repeat(scenario.repeat);
retained.input = input;
const inputBytes = Buffer.byteLength(input);
const lineCount = input.split('\n').length;
await collect();
const inputMemory = readMemory();
retained.output = highlight(input);
const firstCall = readMemory();
await collect();
const holdingOutput = readMemory();
let outputSize: number;

// Inspect output only after sampling: validation must not inflate the peak.
if (typeof retained.output === 'string') {
  outputSize = Buffer.byteLength(retained.output);
  assert.ok(retained.output.startsWith('<pre'));
  assert.ok(retained.output.endsWith('</code></pre>'));
  assert.ok(outputSize > inputBytes);
} else {
  let offset = 0;
  let count = 0;
  const lines = retained.output.tokens;
  assert.equal(lines.length, lineCount);
  for (let line = 0; line < lines.length; line++) {
    for (const token of lines[line]) {
      assert.ok(input.startsWith(token.content, offset));
      offset += token.content.length;
      count++;
    }
    if (line < lines.length - 1) {
      if (input[offset] === '\r') offset++;
      assert.equal(input[offset++], '\n');
    }
  }
  assert.equal(offset, input.length);
  outputSize = count;
}
retained.output = undefined;
await collect();
const result: MemoryResult = {
  runtime: `Bun ${Bun.version}`,
  baseline,
  ready,
  input: inputMemory,
  firstCall,
  holdingOutput,
  releasedOutput: readMemory(),
  inputBytes,
  lines: lineCount,
  outputSize,
};

console.log(JSON.stringify(result));
