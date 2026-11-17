import wasmBytes from './path-store.wasm.mjs';
import { init } from './store';

init(new WebAssembly.Module(wasmBytes));

export { PathStore, init } from './store';
export type { WasmPathStoreConstructorOptions } from './store';
