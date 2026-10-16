import type { BaseDiffOptions, ParseDiffOptions } from '../types';

export function getParseDiffOptions(
  options:
    | Pick<BaseDiffOptions, 'parseDiffOptions' | 'preferredDiffLib'>
    | undefined
): ParseDiffOptions | undefined {
  return options?.preferredDiffLib == null
    ? options?.parseDiffOptions
    : {
        ...options.parseDiffOptions,
        preferredDiffLib: options.preferredDiffLib,
      };
}
