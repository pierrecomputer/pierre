import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { init } from './index';

const wasmBytes = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'chamele.wasm')
);
init(new WebAssembly.Module(wasmBytes));

export * from './index';
