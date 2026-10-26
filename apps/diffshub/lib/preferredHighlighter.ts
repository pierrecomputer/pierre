import { canUseWASM, type HighlighterTypes } from '@pierre/diffs';

// The highlighter diffshub uses: highlights when WebAssembly works, shiki-js
// otherwise. The worker pool, the diffs components, and the theme cycle all
// pass this so they agree on one highlighter type, including when a component
// renders without a pool to override its preference.
export function getPreferredHighlighter(): HighlighterTypes {
  return canUseWASM() ? 'highlights' : 'shiki-js';
}
