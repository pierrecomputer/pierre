'use server';

import type { DiffLineAnnotation } from '@pierre/precision-diffs';
import { preloadMultiFileDiff } from '@pierre/precision-diffs/ssr';
import { cache } from '@solidjs/router';

import { NEW_FILE, OLD_FILE } from '../diff-data';

/**
 * Type definition for annotation metadata.
 * Extend this interface to add custom data to your annotations.
 */
interface AnnotationMetadata {
  message: string;
}

/**
 * Sample annotations to demonstrate interactive annotation slots.
 * Each annotation specifies which side (additions/deletions) and line number to target.
 */
const annotations: DiffLineAnnotation<AnnotationMetadata>[] = [
  {
    side: 'additions',
    lineNumber: 8,
    metadata: {
      message: 'Error on this line in CI.',
    },
  },
];

/**
 * SolidStart cached server function that preloads the diff on the server.
 * Uses precision-diffs SSR API to generate HTML with declarative shadow DOM.
 *
 * @returns Preloaded diff data including prerendered HTML and configuration
 */
export const getPreloadedDiff = cache(async () => {
  'use server';

  const preloadedFileDiff = await preloadMultiFileDiff<AnnotationMetadata>({
    oldFile: OLD_FILE,
    newFile: NEW_FILE,
    options: {
      theme: 'pierre-dark',
      diffStyle: 'split',
      diffIndicators: 'bars',
      overflow: 'scroll',
    },
    annotations,
  });

  return preloadedFileDiff;
}, 'preloaded-diff');
