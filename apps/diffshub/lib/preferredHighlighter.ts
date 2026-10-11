import type { HighlighterTypes } from '@pierre/diffs';

// diffshub renders on the main thread (no worker pool), so every diffs
// component and the preload pass this so they share one highlights instance.
export const PREFERRED_HIGHLIGHTER: HighlighterTypes = 'highlights';
