import wasmModule from './path-store.wasm';
import { init } from './store';

init(wasmModule);

export { PathStore, init } from './store';
export type { WasmPathStoreConstructorOptions } from './store';
