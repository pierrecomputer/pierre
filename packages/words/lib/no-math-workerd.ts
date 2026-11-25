import * as core from './core.ts';
import wasmModule from './words-no-math.wasm';

export type * from './types.ts';

export const {
  init,
  renderToHtml,
  renderToAnsi,
  createHtmlSession,
  canUseWASM,
} = core.createWords(() => wasmModule);
