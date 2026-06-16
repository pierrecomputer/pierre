import type { CodeViewDiffItem, CodeViewItem } from '@pierre/diffs';

import type { CommentMetadata } from './types';

export function isDiffItem(
  item: CodeViewItem<CommentMetadata>
): item is CodeViewDiffItem<CommentMetadata> {
  return item.type === 'diff';
}
