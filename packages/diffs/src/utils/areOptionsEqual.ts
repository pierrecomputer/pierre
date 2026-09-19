import type { CreatePatchOptionsNonabortable } from 'diff';

import type { CodeViewOptions } from '../components/CodeView';
import type { FileDiffOptions } from '../components/FileDiff';
import { DEFAULT_THEMES } from '../constants';
import type { FileOptions } from '../react';
import { areObjectsEqual } from './areObjectsEqual';
import { areThemesEqual } from './areThemesEqual';

type AnyOptions<LAnnotation, LDecoration, Caret> =
  | CodeViewOptions<LAnnotation, LDecoration, Caret>
  | FileOptions<LAnnotation, LDecoration, Caret>
  | FileDiffOptions<LAnnotation, LDecoration, Caret>
  | undefined;

export function areOptionsEqual<LAnnotation, LDecoration, Caret>(
  optionsA: AnyOptions<LAnnotation, LDecoration, Caret>,
  optionsB: AnyOptions<LAnnotation, LDecoration, Caret>
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

function getParseDiffOptions<LAnnotation, LDecoration, Caret>(
  options: AnyOptions<LAnnotation, LDecoration, Caret>
): CreatePatchOptionsNonabortable | undefined {
  if (options != null && 'parseDiffOptions' in options) {
    return options.parseDiffOptions;
  }
  return undefined;
}
