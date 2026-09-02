import type { CreatePatchOptionsNonabortable } from 'diff';

import type { CodeViewOptions } from '../components/CodeView';
import type { FileDiffOptions } from '../components/FileDiff';
import { DEFAULT_THEMES } from '../constants';
import type { FileOptions } from '../react';
import { areObjectsEqual } from './areObjectsEqual';
import { areThemesEqual } from './areThemesEqual';

type AnyOptions<LAnnotation, LDecoration> =
  | CodeViewOptions<LAnnotation, LDecoration>
  | FileOptions<LAnnotation, LDecoration>
  | FileDiffOptions<LAnnotation, LDecoration>
  | undefined;

export function areOptionsEqual<LAnnotation, LDecoration>(
  optionsA: AnyOptions<LAnnotation, LDecoration>,
  optionsB: AnyOptions<LAnnotation, LDecoration>
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

function getParseDiffOptions<LAnnotation, LDecoration>(
  options: AnyOptions<LAnnotation, LDecoration>
): CreatePatchOptionsNonabortable | undefined {
  if (options != null && 'parseDiffOptions' in options) {
    return options.parseDiffOptions;
  }
  return undefined;
}
