import { init } from './index.mjs';
import wasmModule from './md.wasm';

init(wasmModule);

export * from './index.mjs';
