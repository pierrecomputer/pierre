import { init } from './core.ts';
import wasmModule from './words-no-math.wasm';

init(wasmModule);

export * from './core.ts';
