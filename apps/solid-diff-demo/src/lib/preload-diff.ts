"use server";

import { preloadMultiFileDiff } from "@pierre/precision-diffs/ssr";
import type { DiffLineAnnotation } from "@pierre/precision-diffs";
import { OLD_FILE, NEW_FILE } from "../diff-data";
import { cache } from "@solidjs/router";

interface AnnotationMetadata {
  message: string;
}

const annotations: DiffLineAnnotation<AnnotationMetadata>[] = [
  {
    side: "additions",
    lineNumber: 8,
    metadata: {
      message: "Error on this line in CI.",
    },
  },
];

export const getPreloadedDiff = cache(async () => {
  "use server";

  console.log("Preloading diff on server...");

  const preloadedFileDiff = await preloadMultiFileDiff<AnnotationMetadata>({
    oldFile: OLD_FILE,
    newFile: NEW_FILE,
    options: {
      theme: "pierre-dark",
      diffStyle: "split",
      diffIndicators: "bars",
      overflow: "scroll",
    },
    annotations,
  });

  console.log("Diff preloaded on server");

  return preloadedFileDiff;
}, "preloaded-diff");
