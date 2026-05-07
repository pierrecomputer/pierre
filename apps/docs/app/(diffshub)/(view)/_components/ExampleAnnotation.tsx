import type { CodeViewLineSelection, DiffLineAnnotation } from '@pierre/diffs';
import { IconX } from '@pierre/icons';
import { memo } from 'react';

import { annotationCardBase, CommentAuthorAvatar } from './annotation-shared';
import type { SavedCommentMetadata } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
      className={cn(
        annotationCardBase,
        'group relative cursor-pointer hover:border-[rgb(0_0_0_/_0.15)]'
      )}
      onClick={() => onToggleSelection(selection)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        onToggleSelection(selection);
      }}
    >
      <CommentAuthorAvatar seed={annotation.metadata.author} />
      <Button
        variant="default"
        size="icon-sm"
        aria-label="Delete comment"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(itemId, annotation.metadata.key);
        }}
        className="pointer-events-none absolute top-0 right-0 z-1 inline-flex translate-x-[35%] -translate-y-[35%] cursor-pointer items-center justify-center rounded-full bg-neutral-500 opacity-0 shadow-[inherit] transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100"
      >
        <IconX size={12} />
      </Button>
      <div className="flex flex-col">
        <strong className="mt-1 block text-[14px]">
          {annotation.metadata.author}
        </strong>
        <p className="m-0 text-[14px] whitespace-normal">
          {annotation.metadata.message}
        </p>
      </div>
    </div>
  );
});
