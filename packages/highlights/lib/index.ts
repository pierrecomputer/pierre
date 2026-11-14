import { init } from './core';
import { wasmBytes } from './highlighter';
import wasm from './highlights.wasm.mjs';

init(new WebAssembly.Module(wasmBytes(wasm)));

export * from './core';
export * from '../themes/index';
