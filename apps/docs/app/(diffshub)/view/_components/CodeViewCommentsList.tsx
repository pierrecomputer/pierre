'use client';

import type { AnnotationSide } from '@pierre/diffs';
import { memo } from 'react';

import type {
  CodeViewSavedCommentEntry,
  CodeViewSavedCommentItem,
} from './types';
import { cn } from '@/lib/utils';

interface CodeViewCommentsListProps {
  className?: string;
  commentSections: readonly CodeViewSavedCommentItem[];
  onSelectComment?(comment: CodeViewSavedCommentEntry): void;
}

function getCommentSideLabel(side: AnnotationSide): string {
  return side === 'additions' ? 'Added' : 'Deleted';
}

function getCommentSideClassName(side: AnnotationSide): string {
  return side === 'additions'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300';
}

export const CodeViewCommentsList = memo(function CodeViewCommentsList({
  className,
  commentSections,
  onSelectComment,
}: CodeViewCommentsListProps) {
  if (commentSections.length === 0) {
    return (
      <div
        className={cn(
          'text-muted-foreground flex h-full min-h-0 items-center justify-center px-6 text-center text-sm',
          className
        )}
      >
        No comments yet.
      </div>
    );
  }

  return (
    <div
      className={cn(
        'h-full min-h-0 overflow-auto overscroll-contain',
        className
      )}
    >
      {commentSections.map((section) => (
        <section
          key={section.itemId}
          className="border-border border-b last:border-b-0"
        >
          <div className="bg-muted/40 text-foreground px-3 py-2 text-xs font-medium break-all">
            {section.path}
          </div>
          <div className="p-1">
            {section.comments.map((comment) => (
              <button
                key={comment.key}
                type="button"
                className="focus-visible:ring-ring hover:bg-muted flex w-full cursor-pointer flex-col items-start rounded-md px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2"
                onClick={() => onSelectComment?.(comment)}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'rounded border px-1.5 py-0.5 font-medium',
                      getCommentSideClassName(comment.side)
                    )}
                  >
                    {getCommentSideLabel(comment.side)}
                  </span>
                  <span className="text-muted-foreground">
                    Line {comment.lineNumber}
                  </span>
                  <span className="text-muted-foreground">
                    {comment.author}
                  </span>
                </div>
                <p className="text-foreground w-full text-sm break-words whitespace-pre-wrap">
                  {comment.message}
                </p>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
});
