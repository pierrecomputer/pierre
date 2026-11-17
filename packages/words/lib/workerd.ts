import { init } from './core.ts';
import wasmModule from './words.wasm';

init(wasmModule);

export * from './core.ts';
