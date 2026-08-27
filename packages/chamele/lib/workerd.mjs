import wasmModule from './chamele.wasm';
import { init } from './index.mjs';

init(wasmModule);

export * from './index.mjs';
