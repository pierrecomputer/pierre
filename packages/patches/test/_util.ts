import { init } from '../lib/core';
import { optimizeWasm, transformWat, wat2wasm } from '../scripts/build';

// compile the WAT sources in memory, as the build does: tests never need a prior
// build, and they run the optimized code that ships
export const loadWasm = (): WebAssembly.Module =>
  new WebAssembly.Module(
    optimizeWasm(
      wat2wasm(
        'patch.wat',
        transformWat(new URL('../src/patch.wat', import.meta.url))
      )
    )
  );
init(loadWasm);

export * from '../lib/core';
export { mulberry32 } from '../benchmark/fixtures';
