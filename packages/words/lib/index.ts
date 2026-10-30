import { init } from './core.ts';
import wasmBytes from './md.wasm.mjs';

init(new WebAssembly.Module(wasmBytes));

export * from './core.ts';
