import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { type Engine, loadParser, unavailable } from './shared.ts';
import { loadStream } from './stream.ts';

export interface MemoryRequest {
  engine: Engine;
  fixture: string;
  chunkSize: number;
}

export const retained: {
  source?: string;
  output?: string | HTMLElement;
} = {};

async function collect() {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    globalThis.gc!();
  }
}

function readMemory() {
  return {
    ...process.memoryUsage(),
    peakRss: process.resourceUsage().maxRSS * 1024,
  };
}

process.env.NODE_ENV = 'production';
assert.ok(globalThis.gc != null, 'Run the memory worker with --expose-gc');
const request = JSON.parse(process.argv[2]) as MemoryRequest;
await collect();
const baseline = readMemory();
let run: (source: string) => string | HTMLElement;
let cleanup: (() => void) | undefined;
try {
  if (request.engine === 'words-react' || request.engine === 'streamdown') {
    const stream = await loadStream(request.engine);
    run = (source) => stream.run(source, request.chunkSize);
    cleanup = stream.cleanup;
  } else {
    run = await loadParser(request.engine);
  }
} catch (error) {
  if (
    request.engine === 'words' ||
    request.engine === 'words-react' ||
    !unavailable(error)
  )
    throw error;
  console.log(JSON.stringify({ skipped: String(error) }));
  process.exit(0);
}
await collect();
const ready = readMemory();
retained.source = readFileSync(request.fixture, 'utf8');
const inputBytes = Buffer.byteLength(retained.source);
await collect();
const input = readMemory();
retained.output = run(retained.source);
const firstCall = readMemory();
await collect();
const holdingOutput = readMemory();
// Inspect and serialize only after memory sampling, to keep validation out of the peak.
const outputBytes = Buffer.byteLength(
  typeof retained.output === 'string'
    ? retained.output
    : retained.output.innerHTML
);
assert.ok(outputBytes > 0, 'The engine returned no output');
cleanup?.();
retained.output = undefined;
await collect();
const result = {
  baseline,
  ready,
  input,
  firstCall,
  holdingOutput,
  releasedOutput: readMemory(),
  inputBytes,
  outputBytes,
};
export type MemoryResult = typeof result;
console.log(JSON.stringify(result));
