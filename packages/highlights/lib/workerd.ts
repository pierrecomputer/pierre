import wasmModule from './highlights.wasm';
import { init } from './index';

init(wasmModule);

export * from './index';
