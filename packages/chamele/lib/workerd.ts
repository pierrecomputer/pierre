import wasmModule from './chamele.wasm';
import { init } from './index';

init(wasmModule);

export * from './index';
