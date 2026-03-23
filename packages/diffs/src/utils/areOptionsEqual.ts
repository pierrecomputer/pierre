import type { FileDiffOptions } from '../components/FileDiff';
import { DEFAULT_THEMES } from '../constants';
import type { FileOptions } from '../react';
import type { DiffComputeOptions } from '../types';
import { areObjectsEqual } from './areObjectsEqual';
import { areThemesEqual } from './areThemesEqual';

type AnyOptions<L> = FileOptions<L> | FileDiffOptions<L> | undefined;

export function areOptionsEqual<LAnnotation>(
  optionsA: AnyOptions<LAnnotation>,
  optionsB: AnyOptions<LAnnotation>
): boolean {
  const themeA = optionsA?.theme ?? DEFAULT_THEMES;
  const themeB = optionsB?.theme ?? DEFAULT_THEMES;
  const diffOptsA = getDiffOptions(optionsA);
  const diffOptsB = getDiffOptions(optionsB);
  return (
    areThemesEqual(themeA, themeB) &&
    areObjectsEqual(optionsA, optionsB, [
      'theme',
      'diffOptions' as keyof typeof optionsA,
    ]) &&
    areObjectsEqual(diffOptsA ?? {}, diffOptsB ?? {})
  );
}

function getDiffOptions<L>(
  options: AnyOptions<L>
): DiffComputeOptions | undefined {
  if (options != null && 'diffOptions' in options) {
    return options.diffOptions;
  }
  return undefined;
}
