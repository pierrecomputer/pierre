import { readFileSync } from 'node:fs';

import { init } from './index.mjs';

init(new WebAssembly.Module(readFileSync(new URL('md.wasm', import.meta.url))));

export * from './index.mjs';
