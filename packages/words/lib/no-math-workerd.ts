import * as core from './core.ts';
import type { AnsiOptions, RenderOptions } from './types.ts';
import wasmModule from './words-no-math.wasm';

export type * from './types.ts';

const state: core.State = { load: () => wasmModule };

export const init = (module: WebAssembly.Module): core.Renderer =>
  (state.renderer = new core.Renderer(module));

/**
 * Whether this engine can run Words' Wasm, which needs SIMD. Use it to pick a
 * fallback renderer. It compiles the Wasm once and keeps it for rendering.
 */
export const canUseWASM = (): boolean => core.canUseWASM(state);

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
