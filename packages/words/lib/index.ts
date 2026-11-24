import * as core from './core.ts';
import wasmBytes from './words.wasm.mjs';

export type * from './types.ts';

export const {
  init,
  renderToHtml,
  renderToAnsi,
  createHtmlSession,
  canUseWASM,
} = core.createWords(() => new WebAssembly.Module(wasmBytes));
