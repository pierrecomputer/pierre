import {
  createTwoFilesPatch as createPatches,
  diffChars as diffPatchesChars,
  diffWordsWithSpace as diffPatchesWords,
} from '@pierre/patches';
import { createTwoFilesPatch, diffChars, diffWordsWithSpace } from 'diff';

import type { CreatePatchOptions, DiffLib } from '../types';

export const diffLibs: Record<
  DiffLib,
  {
    createTwoFilesPatch(
      oldFileName: string,
      newFileName: string,
      oldStr: string,
      newStr: string,
      oldHeader?: string,
      newHeader?: string,
      options?: CreatePatchOptions
    ): string;
    diffChars: typeof diffPatchesChars;
    diffWordsWithSpace: typeof diffPatchesWords;
  }
> = {
  jsdiff: { createTwoFilesPatch, diffChars, diffWordsWithSpace },
  '@pierre/patches': {
    createTwoFilesPatch: createPatches,
    diffChars: diffPatchesChars,
    diffWordsWithSpace: diffPatchesWords,
  },
};

let patchesWork: boolean | undefined;

/**
 * Pick jsdiff when `@pierre/patches` cannot load, so a page that blocks
 * WebAssembly fails and logs once, not on every diff.
 * WARNING: do not use `canUseWASM` here. Cloudflare Workers block its runtime
 * compile, but this package loads a precompiled module there and works.
 */
export function resolveDiffLib(preferred: DiffLib): DiffLib {
  if (preferred === 'jsdiff') {
    return preferred;
  }
  if (patchesWork === undefined) {
    try {
      diffPatchesChars('', '');
      patchesWork = true;
    } catch (error) {
      console.error(error);
      patchesWork = false;
    }
  }
  return patchesWork ? preferred : 'jsdiff';
}
