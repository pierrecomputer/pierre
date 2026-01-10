import type { FileDiffMetadata } from '@pierre/diffs';

export const IMAGE_DIFF_CHANGED: FileDiffMetadata = {
  name: 'hero-image.png',
  prevName: 'hero-image.png',
  type: 'change',
  contentType: 'image',
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  oldImageUrl: 'https://picsum.photos/seed/pierre-old/600/400',
  newImageUrl: 'https://picsum.photos/seed/pierre-new/600/400',
  oldImageMetadata: { width: 600, height: 400 },
  newImageMetadata: { width: 600, height: 400 },
};

export const IMAGE_DIFF_NEW: FileDiffMetadata = {
  name: 'new-feature.png',
  prevName: undefined,
  type: 'new',
  contentType: 'image',
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  newImageUrl: 'https://picsum.photos/seed/pierre-added/400/300',
  newImageMetadata: { width: 400, height: 300 },
};

export const IMAGE_DIFF_DELETED: FileDiffMetadata = {
  name: 'deprecated-icon.png',
  prevName: 'deprecated-icon.png',
  type: 'deleted',
  contentType: 'image',
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  oldImageUrl: 'https://picsum.photos/seed/pierre-deleted/400/300',
  oldImageMetadata: { width: 400, height: 300 },
};
