import { init } from '../lib/core';
import { transformWat, wat2wasm } from '../scripts/build';

// compile the WAT sources in memory: tests never need a prior build
export const loadWasm = (): WebAssembly.Module =>
  new WebAssembly.Module(
    wat2wasm(
      'patch.wat',
      transformWat(new URL('../src/patch.wat', import.meta.url))
    )
  );
init(loadWasm);

export * from '../lib/core';

/** Deterministic PRNG for reproducible fuzzing. */
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
