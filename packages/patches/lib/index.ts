import { init } from './core';
import wasmBytes from './patch.wasm.mjs';

init(() => new WebAssembly.Module(wasmBytes));

export * from './core';
