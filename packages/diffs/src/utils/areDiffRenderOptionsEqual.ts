import { defaultHighlighter } from '../highlighter';
import type { RenderDiffOptions } from '../types';
import { areThemesEqual } from './areThemesEqual';

export function areDiffRenderOptionsEqual(
  optionsA: RenderDiffOptions,
  optionsB: RenderDiffOptions
): boolean {
  return (
    (optionsA.preferredHighlighter ?? defaultHighlighter) ===
      (optionsB.preferredHighlighter ?? defaultHighlighter) &&
    areThemesEqual(optionsA.theme, optionsB.theme) &&
    optionsA.useTokenTransformer === optionsB.useTokenTransformer &&
    optionsA.tokenizeMaxLineLength === optionsB.tokenizeMaxLineLength &&
    optionsA.lineDiffType === optionsB.lineDiffType &&
    optionsA.maxLineDiffLength === optionsB.maxLineDiffLength
  );
}
