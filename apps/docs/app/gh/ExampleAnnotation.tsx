import type { DiffLineAnnotation } from '@pierre/diffs';

import type { SavedCommentMetadata } from './types';

interface ExampleAnnotationProps {
  annotation: DiffLineAnnotation<SavedCommentMetadata>;
  itemId: string;
  onDelete(itemId: string, key: string): void;
}

export function ExampleAnnotation({
  annotation,
  itemId,
  onDelete,
}: ExampleAnnotationProps) {
  return (
    <div className="group relative m-2 max-w-[600px] overflow-visible rounded-sm border border-[var(--color-border)] bg-[var(--color-muted)] p-2">
      <button
        type="button"
        aria-label="Delete comment"
        onClick={() => onDelete(itemId, annotation.metadata.key)}
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
}
