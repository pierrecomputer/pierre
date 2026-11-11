// WARNING: The main entry loads no Wasm. The shared functions and tokenizers
// need the combined module, so only `@pierre/highlights/full` exports them as
// values.
export type * from './index';
export { createHighlighter, isSupportedLanguage } from './highlighter';
