import { optimizeWasm, transformWat, wat2wasm } from '../scripts/build';

const sourceUrl = new URL('../src/path-store.wat', import.meta.url);

/** Compile the engine from the WAT sources, with or without Binaryen. */
export function compileEngine(optimize = true): WebAssembly.Module {
  const { code } = transformWat(sourceUrl);
  const raw = wat2wasm(sourceUrl.pathname, code);
  return new WebAssembly.Module(optimize ? optimizeWasm(raw) : raw);
}
