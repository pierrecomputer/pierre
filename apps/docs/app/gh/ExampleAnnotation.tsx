import type { CodeViewLineSelection, DiffLineAnnotation } from '@pierre/diffs';
import { memo } from 'react';

import type { SavedCommentMetadata } from './types';

interface ExampleAnnotationProps {
  annotation: DiffLineAnnotation<SavedCommentMetadata>;
  itemId: string;
  onDelete(itemId: string, key: string): void;
  onToggleSelection(selection: CodeViewLineSelection): void;
}

export const ExampleAnnotation = memo(function ExampleAnnotation({
  annotation,
  itemId,
  onDelete,
  onToggleSelection,
}: ExampleAnnotationProps) {
  const selection = { id: itemId, range: annotation.metadata.range };
  return (
    <div
      role="button"
      tabIndex={0}
      className="group relative m-2 max-w-[600px] cursor-pointer overflow-visible rounded-sm border border-[var(--color-border)] bg-[var(--color-muted)] p-2"
      onClick={() => onToggleSelection(selection)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        onToggleSelection(selection);
      }}
    >
      <button
        type="button"
        aria-label="Delete comment"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(itemId, annotation.metadata.key);
        }}
        className="pointer-events-none absolute top-0 right-0 z-1 inline-flex h-[22px] w-[22px] translate-x-[35%] -translate-y-[35%] cursor-pointer items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-background)] pb-0.5 text-[22px] leading-4 text-[var(--color-foreground)] opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
      >
        ×
      </button>
      <strong className="mb-1 block text-[13px]">
        {annotation.metadata.author}
      </strong>
      <p className="m-0 text-[13px] whitespace-normal">
        {annotation.metadata.message}
      </p>
    </div>
  );
});
