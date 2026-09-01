import type { FileDiffOptions } from '../components/FileDiff';
import { parsePatchFiles } from '../utils/parsePatchFiles';
import { preloadFileDiff, type PreloadFileDiffResult } from './preloadDiffs';

export type PreloadPatchFileOptions<LAnnotation, Caret> = {
  patch: string;
  options?: FileDiffOptions<LAnnotation, Caret>;
  // We need to support annotations, but it's unclear the best way to do this
  // right now... (i.e. what API people would want, so intentionally leaving
  // this blank for now)
};

export async function preloadPatchFile<
  LAnnotation = undefined,
  Caret = undefined,
>({
  patch,
  options,
}: PreloadPatchFileOptions<LAnnotation, Caret>): Promise<
  PreloadFileDiffResult<LAnnotation, Caret>[]
> {
  const diffs: Promise<PreloadFileDiffResult<LAnnotation, Caret>>[] = [];
  const patches = parsePatchFiles(patch);
  for (const patch of patches) {
    for (const fileDiff of patch.files) {
      diffs.push(preloadFileDiff<LAnnotation, Caret>({ fileDiff, options }));
    }
  }
  return await Promise.all(diffs);
}
