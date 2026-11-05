import { canUseWASM, type DiffLib, type ParseDiffOptions } from '@pierre/diffs';

export function getPreferredDiffLib(): DiffLib {
  return canUseWASM() ? '@pierre/patches' : 'jsdiff';
}

// Share the backend between initial parsing, SSR, and client-side edits.
export const DEFAULT_PARSE_DIFF_OPTIONS: ParseDiffOptions = {
  preferredDiffLib: getPreferredDiffLib(),
};
