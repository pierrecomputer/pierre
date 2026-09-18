import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { init } from './index';

const wasmBytes = readFileSync(
  fileURLToPath(new URL('highlights.wasm', import.meta.url))
);
init(new WebAssembly.Module(wasmBytes));

export * from './index';
