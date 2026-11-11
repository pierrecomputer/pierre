import emitterModule from './emitter.wasm';
import { initEmitter } from './highlighter';

initEmitter(emitterModule);

export * from './core';
