import type { BundledHighlighterOptions } from '@shikijs/core';
import {
  type BundledLanguage,
  type BundledTheme,
  createHighlighter,
  createOnigurumaEngine,
  loadWasm,
} from 'shiki';

export async function createStreamingHighlighter(
  options: Omit<
    BundledHighlighterOptions<BundledLanguage, BundledTheme>,
    'engine'
  >
) {
  await loadWasm(import('shiki/wasm'));
  return await createHighlighter({
    ...options,
    engine: createOnigurumaEngine(),
  });
}
