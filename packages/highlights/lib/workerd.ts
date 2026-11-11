import { init } from './core';
import emitterModule from './emitter.wasm';
import { initEmitter } from './highlighter';
import wasmModule from './highlights.wasm';

init(wasmModule);
initEmitter(emitterModule);

export * from './core';
export * from '../themes/index';
