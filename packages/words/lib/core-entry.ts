// `@pierre/words/core`: the root API without the embedded module.
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

/**
 * Render a growing string to HTML. A session keeps completed HTML and reparses
 * only the unfinished end.
 */
export const createHtmlSession = (): core.HtmlSession =>
  core.createHtmlSession(state);
