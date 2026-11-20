// `@pierre/words/no-math`: Words without TeX math (scripts/build.ts --no-math),
// about a third smaller. The `math` option shows formulas as code.
import { init } from './core.ts';
import wasmBytes from './words-no-math.wasm.mjs';

init(new WebAssembly.Module(wasmBytes));

export * from './core.ts';
