import emitterModule from './emitter.wasm';
import { initEmitter } from './highlighter';
import wasmModule from './highlights.wasm';
import { init } from './index';

init(wasmModule);
initEmitter(emitterModule);

export * from './index';
