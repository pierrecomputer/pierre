import { canUseWASM, type HighlighterTypes } from '@pierre/diffs';

// The highlighter docs uses in the browser: highlights when WebAssembly works,
// shiki-js otherwise. The main thread holds one highlighter type at a time, and
// the first load claims it. So the worker pool and every main-thread preload
// name this backend explicitly. A preload that omits it can claim the shared
// highlighter for shiki-js, and the pool's small-file main-thread highlights
// would then run on Shiki.
export function getPreferredHighlighter(): HighlighterTypes {
  return canUseWASM() ? 'highlights' : 'shiki-js';
}
