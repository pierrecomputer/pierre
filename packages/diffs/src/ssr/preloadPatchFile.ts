import type { FileDiffOptions } from '../FileDiff';
import { parsePatchFiles } from '../utils/parsePatchFiles';
import { type PreloadFileDiffResult, preloadFileDiff } from './preloadDiffs';

export type PreloadPatchFileOptions<LAnnotation> = {
  patch: string;
  options?: FileDiffOptions<LAnnotation>;
  // We need to support annotations, but it's unclear the best way to do this
  // right now... (i.e. what API people would want, so intentionally leaving
  // this blank for now)
};

export async function preloadPatchFile<LAnnotation = undefined>({
  patch,
  options,
}: PreloadPatchFileOptions<LAnnotation>): Promise<
  PreloadFileDiffResult<LAnnotation>[]
> {
  const diffs: Promise<PreloadFileDiffResult<LAnnotation>>[] = [];
  const patches = parsePatchFiles(patch);
  for (const patch of patches) {
    for (const fileDiff of patch.files) {
      diffs.push(preloadFileDiff<LAnnotation>({ fileDiff, options }));
    }
  }
  return await Promise.all(diffs);
}
