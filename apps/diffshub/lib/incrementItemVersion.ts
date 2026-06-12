import type { CodeViewItem } from '@pierre/diffs';

import type { CommentMetadata } from './types';

export function incrementItemVersion(item: CodeViewItem<CommentMetadata>) {
  item.version = typeof item.version === 'number' ? item.version + 1 : 1;
}
