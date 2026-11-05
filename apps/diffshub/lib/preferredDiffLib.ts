import { canUseWASM, type DiffLib } from '@pierre/diffs';

export function getPreferredDiffLib(): DiffLib {
  return canUseWASM() ? '@pierre/patches' : 'jsdiff';
}
