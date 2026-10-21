import type { RenderDiffOptions } from '../types';
import { areThemesEqual } from './areThemesEqual';

export function areDiffRenderOptionsEqual(
  optionsA: RenderDiffOptions,
  optionsB: RenderDiffOptions
): boolean {
  return (
    areThemesEqual(optionsA.theme, optionsB.theme) &&
    (optionsA.preferredDiffLib ?? 'jsdiff') ===
      (optionsB.preferredDiffLib ?? 'jsdiff') &&
    optionsA.useTokenTransformer === optionsB.useTokenTransformer &&
    optionsA.tokenizeMaxLineLength === optionsB.tokenizeMaxLineLength &&
    optionsA.lineDiffType === optionsB.lineDiffType &&
    optionsA.maxLineDiffLength === optionsB.maxLineDiffLength
  );
}
