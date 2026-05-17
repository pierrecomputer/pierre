import type { RenderFileOptions } from '../types';
import { areThemesEqual } from './areThemesEqual';

export function areFileRenderOptionsEqual(
  optionsA: RenderFileOptions,
  optionsB: RenderFileOptions
): boolean {
  return (
    areThemesEqual(optionsA.theme, optionsB.theme) &&
    optionsA.useTokenTransformer === optionsB.useTokenTransformer &&
    optionsA.tokenizeMaxLineLength === optionsB.tokenizeMaxLineLength
  );
}
