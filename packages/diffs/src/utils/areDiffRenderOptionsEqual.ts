import type { RenderDiffOptions } from '../types';
import { areThemesEqual } from './areThemesEqual';

export function areDiffRenderOptionsEqual(
  optionsA: RenderDiffOptions,
  optionsB: RenderDiffOptions
): boolean {
  return (
    areThemesEqual(optionsA.theme, optionsB.theme) &&
    optionsA.tokenizeMaxLineLength === optionsB.tokenizeMaxLineLength &&
    optionsA.lineDiffType === optionsB.lineDiffType &&
    optionsA.maxLineDiffLength === optionsB.maxLineDiffLength
  );
}
