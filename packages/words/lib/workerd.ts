import * as core from './core.ts';
import wasmModule from './words.wasm';

export type * from './types.ts';

export const { init, renderToHtml, renderToAnsi, createHtmlSession } =
  core.createWords(new core.Renderer(wasmModule));
