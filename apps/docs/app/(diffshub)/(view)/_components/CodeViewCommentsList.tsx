'use client';

import type { AnnotationSide } from '@pierre/diffs';
import { IconConvoFill } from '@pierre/icons';
import { memo } from 'react';

import { CommentAuthorAvatar } from './annotation-shared';
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

function getCommentLineLabel(side: AnnotationSide, lineNumber: number): string {
  const sigil = side === 'additions' ? '+' : '-';
  return `Line ${sigil}${lineNumber}`;
}

function getCommentLineClassName(side: AnnotationSide): string {
  return side === 'additions'
    ? 'text-emerald-700 dark:text-emerald-400'
    : 'text-rose-700 dark:text-rose-400';
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
          'text-muted-foreground flex flex-col gap-2 h-full min-h-0 items-center justify-center px-7 text-center text-sm',
          className
        )}
      >
        <IconConvoFill size={24} className="mb-2" />
        <div className="flex flex-col">
          <strong className="font-medium">No comments yet</strong>
          <p>
            Hover over a line and click the blue button to add fake code
            comments.
          </p>
        </div>
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
        <section key={section.itemId}>
          <div className="text-muted-foreground p-3 pb-2 text-sm font-medium break-all">
            {section.path}
          </div>
          <div className="mx-3 rounded-lg border border-[rgb(0_0_0_/_0.1)] dark:border-[rgb(255_255_255_/_0.15)]">
            {section.comments.map((comment) => (
              <button
                key={comment.key}
                type="button"
                className="focus-visible:ring-ring hover:bg-muted bg-card flex w-full cursor-pointer items-start gap-2 border-b border-[rgb(0_0_0_/_0.1)] p-3 text-left text-sm transition-colors outline-none first:rounded-t-lg last:rounded-b-lg last:border-b-0 focus-visible:ring-2 dark:border-[rgb(255_255_255_/_0.15)] dark:bg-neutral-800 dark:hover:bg-neutral-900"
                onClick={() => onSelectComment?.(comment)}
              >
                <CommentAuthorAvatar seed={comment.author} className="size-5" />
                <div className="flex flex-col items-center gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {comment.author} commented on{' '}
                      <span
                        className={cn(
                          getCommentLineClassName(comment.side),
                          'font-medium'
                        )}
                      >
                        {getCommentLineLabel(comment.side, comment.lineNumber)}
                      </span>
                    </span>
                  </div>
                  <p className="text-foreground w-full break-words whitespace-pre-wrap">
                    {comment.message}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
});
