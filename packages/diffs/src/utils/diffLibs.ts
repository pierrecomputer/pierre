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
