import type { JSX } from 'preact';

import type { FileMetadata } from '../types';

export function MetadataBadge({
  metadata,
}: {
  metadata: FileMetadata;
}): JSX.Element | null {
  'use no memo';
  const { status, additions, deletions } = metadata;
  const hasLineCounts = additions != null || deletions != null;

  if (status == null && !hasLineCounts) {
    return null;
  }

  return (
    <span data-item-section="metadata" data-item-status={status}>
      {hasLineCounts ? (
        <span data-item-line-counts>
          {additions != null ? (
            <span data-item-additions>+{additions}</span>
          ) : null}
          {deletions != null ? (
            <span data-item-deletions>-{deletions}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
