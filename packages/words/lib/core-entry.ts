// `@pierre/words/core`: the root entry's API without an embedded module. The
// caller loads one (`@pierre/words/words.wasm`, `words-no-math.wasm` or its own
// build) and passes it to `init()` before the first render.
import * as core from './core.ts';
import type { AnsiOptions, RenderOptions } from './types.ts';

export type * from './types.ts';

let renderer: core.Renderer | undefined;
const state: core.State = {
  get renderer() {
    if (renderer === undefined)
      throw new Error('@pierre/words/core: call init() before rendering');
    return renderer;
  },
};

export const init = (module: WebAssembly.Module): core.Renderer =>
  (renderer = new core.Renderer(module));

export const renderToHtml = ((input: core.Input, options?: RenderOptions) =>
  core.renderToHtml(state, input, options)) as core.RenderToHtml;

export const renderToAnsi = (
  input: core.Input,
  options?: AnsiOptions
): Uint8Array => core.renderToAnsi(state, input, options);

/** @see `createHtmlSession` of `@pierre/words` */
export const createHtmlSession = (): core.HtmlSession =>
  core.createHtmlSession(state);
