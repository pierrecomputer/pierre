import type { FileDiffOptions } from '../components/FileDiff';
import { DEFAULT_THEMES } from '../constants';
import type { FileOptions } from '../react';
import { areObjectsEqual } from './areObjectsEqual';
import { areThemesEqual } from './areThemesEqual';

export function areOptionsEqual<LAnnotation>(
  optionsA: FileOptions<LAnnotation> | FileDiffOptions<LAnnotation> | undefined,
  optionsB: FileOptions<LAnnotation> | FileDiffOptions<LAnnotation> | undefined
): boolean {
  const themeA = optionsA?.theme ?? DEFAULT_THEMES;
  const themeB = optionsB?.theme ?? DEFAULT_THEMES;
  return (
    areThemesEqual(themeA, themeB) &&
    areObjectsEqual(optionsA, optionsB, ['theme'])
  );
}
