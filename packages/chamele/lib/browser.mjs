import wasmBytes from './chamele.wasm.mjs';
import { init } from './index.mjs';

init(new WebAssembly.Module(wasmBytes));

export * from './index.mjs';
