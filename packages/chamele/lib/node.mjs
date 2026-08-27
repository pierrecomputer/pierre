import { readFileSync } from 'node:fs';

import { init } from './index.mjs';

const wasmBytes = readFileSync(new URL('chamele.wasm', import.meta.url));
init(new WebAssembly.Module(wasmBytes));

export * from './index.mjs';
