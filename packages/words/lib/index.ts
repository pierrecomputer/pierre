import * as core from './core.ts';
import wasmBytes from './words.wasm.mjs';

export type * from './types.ts';

export const { init, renderToHtml, renderToAnsi, createHtmlSession } =
  core.createWords(new core.Renderer(new WebAssembly.Module(wasmBytes)));
