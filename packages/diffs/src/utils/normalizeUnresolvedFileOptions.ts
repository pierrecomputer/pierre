import type { FileDiffOptions } from '../components/FileDiff';
import { getMergeConflictActionsUnsafeCSS } from './getMergeConflictActionsUnsafeCSS';

interface NormalizeUnresolvedFileOptionsConfig {
  includeActionsUnsafeCSS?: boolean;
}

export function normalizeUnresolvedFileOptions<LAnnotation>(
  options: FileDiffOptions<LAnnotation> | undefined,
  config: NormalizeUnresolvedFileOptionsConfig = {}
): FileDiffOptions<LAnnotation> {
  const { includeActionsUnsafeCSS = false } = config;
  const normalizedUnsafeCSS = includeActionsUnsafeCSS
    ? getMergeConflictActionsUnsafeCSS(options?.unsafeCSS)
    : options?.unsafeCSS;
  const normalizedOptions: FileDiffOptions<LAnnotation> = {
    ...options,
    diffStyle: 'unified',
    lineDiffType: options?.lineDiffType ?? 'none',
  };
  if (normalizedUnsafeCSS != null) {
    normalizedOptions.unsafeCSS = normalizedUnsafeCSS;
  }
  return normalizedOptions;
}
