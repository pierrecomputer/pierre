// `@pierre/words/no-math`: Words without TeX math (scripts/build.ts --no-math),
// about a third smaller. The `math` option shows formulas as code.
import * as core from './core.ts';
import wasmBytes from './words-no-math.wasm.mjs';

export type * from './types.ts';

export const {
  init,
  renderToHtml,
  renderToAnsi,
  createHtmlSession,
  canUseWASM,
} = core.createWords(() => new WebAssembly.Module(wasmBytes));
