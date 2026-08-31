import wasmBytes from './chamele.wasm.mjs';
import { init } from './index';

init(new WebAssembly.Module(wasmBytes));

export * from './index';
