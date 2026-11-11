import { init } from './core';
import wasmBytes from './highlights.wasm.mjs';

init(new WebAssembly.Module(wasmBytes));

export * from './core';
export * from '../themes/index';
