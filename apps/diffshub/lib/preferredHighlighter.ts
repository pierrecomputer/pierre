import type { HighlighterTypes } from '@pierre/diffs';

// Every diffs component, the preload, and the worker pool pass this so they
// share one highlights instance. The pool swaps it for shiki-js when
// WebAssembly is unavailable, and its choice overrides the components'.
export const PREFERRED_HIGHLIGHTER: HighlighterTypes = 'highlights';
