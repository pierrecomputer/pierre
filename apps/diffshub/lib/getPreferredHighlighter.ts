import type { DiffsHighlighter } from '@pierre/diffs';

/**
 * Fallback to the JS build of Shiki when WASM is not available
 */
export function getPreferredHighlighter(): DiffsHighlighter['name'] {
  return typeof WebAssembly === 'undefined' ? 'shiki-js' : 'shiki-wasm';
}
