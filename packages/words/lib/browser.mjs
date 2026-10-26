import { init } from './index.mjs';
import wasmBytes from './md.wasm.mjs';

init(new WebAssembly.Module(wasmBytes));

export * from './index.mjs';
