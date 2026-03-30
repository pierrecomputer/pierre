import type { CreatePatchOptionsNonabortable } from 'diff';

import type { FileDiffOptions } from '../components/FileDiff';
import { DEFAULT_THEMES } from '../constants';
import type { FileOptions } from '../react';
import { areObjectsEqual } from './areObjectsEqual';
import { areThemesEqual } from './areThemesEqual';

type AnyOptions<L> = FileOptions<L> | FileDiffOptions<L> | undefined;

export function areOptionsEqual<LAnnotation>(
  optionsA: AnyOptions<LAnnotation>,
  optionsB: AnyOptions<LAnnotation>
): boolean {
  const themeA = optionsA?.theme ?? DEFAULT_THEMES;
  const themeB = optionsB?.theme ?? DEFAULT_THEMES;
  const diffOptsA = getParseDiffOptions(optionsA);
  const diffOptsB = getParseDiffOptions(optionsB);
  return (
    areThemesEqual(themeA, themeB) &&
    areObjectsEqual(optionsA, optionsB, [
      'theme',
      'parseDiffOptions' as keyof typeof optionsA,
    ]) &&
    areObjectsEqual(diffOptsA, diffOptsB)
  );
}

function getParseDiffOptions<L>(
  options: AnyOptions<L>
): CreatePatchOptionsNonabortable | undefined {
  if (options != null && 'parseDiffOptions' in options) {
    return options.parseDiffOptions;
  }
  return undefined;
}
