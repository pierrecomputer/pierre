import { init } from './core.ts';
import wasmModule from './md.wasm';

init(wasmModule);

export * from './core.ts';
