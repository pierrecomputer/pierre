import { init } from './core.ts';
import wasmBytes from './words.wasm.mjs';

init(new WebAssembly.Module(wasmBytes));

export * from './core.ts';
