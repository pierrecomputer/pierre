import { init } from './core';
import wasmModule from './patch.wasm';

init(() => wasmModule);

export * from './core';
