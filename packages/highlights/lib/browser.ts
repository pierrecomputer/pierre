import wasmBytes from './highlights.wasm.mjs';
import { init } from './index';

init(new WebAssembly.Module(wasmBytes));

export * from './index';
