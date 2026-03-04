import type { FileDiffOptions } from '../components/FileDiff';

export function normalizeUnresolvedFileOptions<LAnnotation>(
  options: FileDiffOptions<LAnnotation> | undefined
): FileDiffOptions<LAnnotation> {
  const normalizedOptions: FileDiffOptions<LAnnotation> = {
    ...options,
    diffStyle: 'unified',
    lineDiffType: options?.lineDiffType ?? 'none',
  };
  return normalizedOptions;
}
