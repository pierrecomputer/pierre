import type {
  CodeViewOptions,
  CodeViewSearchOptions,
} from '../components/CodeView';
import type { FileDiffOptions } from '../components/FileDiff';
import { DEFAULT_THEMES } from '../constants';
import type { FileOptions } from '../react';
import type { ParseDiffOptions } from '../types';
import { areObjectsEqual } from './areObjectsEqual';
import { areThemesEqual } from './areThemesEqual';

type AnyOptions<L, C> =
  | CodeViewOptions<L, C>
  | FileOptions<L, C>
  | FileDiffOptions<L, C>
  | undefined;

export function areOptionsEqual<LAnnotation, Caret>(
  optionsA: AnyOptions<LAnnotation, Caret>,
  optionsB: AnyOptions<LAnnotation, Caret>
): boolean {
  const searchOptionsA = getSearchOptions(optionsA);
  const searchOptionsB = getSearchOptions(optionsB);
  return (
    areThemesEqual(
      optionsA?.theme ?? DEFAULT_THEMES,
      optionsB?.theme ?? DEFAULT_THEMES
    ) &&
    areObjectsEqual(optionsA, optionsB, [
      'theme',
      'parseDiffOptions' as keyof typeof optionsA,
      'searchOptions' as keyof typeof optionsA,
    ]) &&
    areObjectsEqual(
      getParseDiffOptions(optionsA),
      getParseDiffOptions(optionsB)
    ) &&
    areObjectsEqual(searchOptionsA, searchOptionsB, ['defaults']) &&
    areObjectsEqual(searchOptionsA?.defaults, searchOptionsB?.defaults)
  );
}

function getSearchOptions<L, C>(
  options: AnyOptions<L, C>
): CodeViewSearchOptions | undefined {
  if (options != null && 'searchOptions' in options) {
    return options.searchOptions;
  }
  return undefined;
}

function getParseDiffOptions<L, C>(
  options: AnyOptions<L, C>
): ParseDiffOptions | undefined {
  if (options != null && 'parseDiffOptions' in options) {
    return options.parseDiffOptions;
  }
  return undefined;
}
