import * as core from './core.ts';
import type { AnsiOptions, RenderOptions } from './types.ts';
import wasmBytes from './words.wasm.mjs';

export type * from './types.ts';

const state: core.State = {
  renderer: new core.Renderer(new WebAssembly.Module(wasmBytes)),
};

export const init = (module: WebAssembly.Module): core.Renderer =>
  (state.renderer = new core.Renderer(module));

export const renderToHtml = ((input: core.Input, options?: RenderOptions) =>
  core.renderToHtml(state, input, options)) as core.RenderToHtml;

export const renderToAnsi = (
  input: core.Input,
  options?: AnsiOptions
): Uint8Array => core.renderToAnsi(state, input, options);

/**
 * Render a growing string to HTML. A session keeps completed HTML and reparses
 * only the unfinished end.
 */
export const createHtmlSession = (): core.HtmlSession =>
  core.createHtmlSession(state);
