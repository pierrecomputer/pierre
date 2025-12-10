import type { FileDiffOptions } from 'src/components/FileDiff';
import { DEFAULT_THEMES } from 'src/constants';
import type { FileOptions } from 'src/react';

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
