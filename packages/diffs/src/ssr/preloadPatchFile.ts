import type { FileDiffOptions } from '../components/FileDiff';
import { parsePatchFiles } from '../utils/parsePatchFiles';
import { preloadFileDiff, type PreloadFileDiffResult } from './preloadDiffs';

export interface PreloadPatchFileOptions<LAnnotation, LDecoration> {
  patch: string;
  options?: FileDiffOptions<LAnnotation, LDecoration>;
  // We need to support annotations, but it's unclear the best way to do this
  // right now... (i.e. what API people would want, so intentionally leaving
  // this blank for now)
}

export async function preloadPatchFile<
  LAnnotation = undefined,
  LDecoration = undefined,
>({
  patch,
  options,
}: PreloadPatchFileOptions<LAnnotation, LDecoration>): Promise<
  PreloadFileDiffResult<LAnnotation, LDecoration>[]
> {
  const diffs: Promise<PreloadFileDiffResult<LAnnotation, LDecoration>>[] = [];
  const patches = parsePatchFiles(patch);
  for (const patch of patches) {
    for (const fileDiff of patch.files) {
      diffs.push(
        preloadFileDiff<LAnnotation, LDecoration>({ fileDiff, options })
      );
    }
  }
  return await Promise.all(diffs);
}
