import { initLazy, wasmBytes } from './highlighter';
import wasm from './highlights.wasm.mjs';

initLazy(() => new WebAssembly.Module(wasmBytes(wasm)));

export * from './core';
export * from '../themes/index';
