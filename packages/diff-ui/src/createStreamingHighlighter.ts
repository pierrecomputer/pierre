import {
  createHighlighter,
  createOnigurumaEngine,
  loadWasm,
  type BundledLanguage,
  type BundledTheme,
} from 'shiki';
import type { BundledHighlighterOptions } from '@shikijs/core';

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
