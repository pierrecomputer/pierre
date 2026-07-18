'use client';

import type { AnnotationSide } from '@pierre/diffs';
import { useCallback, useEffect, useRef } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

// Annotation content shared by the playground's view modes: a comment form
// for freshly added gutter comments, the submitted comment it becomes, and a
// static example thread. `side` is undefined for plain file annotations,
// which have no diff side.
export function CommentForm({
  side,
  lineNumber,
  onCancel,
  onSubmit,
}: {
  side: AnnotationSide | undefined;
  lineNumber: number;
  onCancel: (side: AnnotationSide | undefined, lineNumber: number) => void;
  onSubmit: (
    side: AnnotationSide | undefined,
    lineNumber: number,
    body: string
  ) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, []);

  const handleCancel = useCallback(() => {
    onCancel(side, lineNumber);
  }, [side, lineNumber, onCancel]);

  const handleSubmit = useCallback(() => {
    const body = textareaRef.current?.value.trim() ?? '';
    // An empty submit has no comment to keep; treat it as a cancel.
    if (body === '') {
      onCancel(side, lineNumber);
      return;
    }
    onSubmit(side, lineNumber, body);
  }, [side, lineNumber, onCancel, onSubmit]);

  return (
    <div
      style={{
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'row',
        gap: 1,
      }}
    >
      <div style={{ width: '100%' }}>
        <div
          className="max-w-[95%] sm:max-w-[70%]"
          style={{
            whiteSpace: 'normal',
            margin: 10,
            fontFamily: 'Geist',
          }}
        >
          <div className="bg-card rounded-lg border p-3 shadow-[0_2px_4px_rgba(0,0,0,0.05)]">
            <div className="flex gap-2">
              <div className="relative -mt-0.5 flex-shrink-0">
                <Avatar className="h-6 w-6">
                  <AvatarImage src="/avatars/avatar_fat.jpg" alt="You" />
                  <AvatarFallback>Y</AvatarFallback>
                </Avatar>
              </div>
              <div className="flex-1">
                <textarea
                  ref={textareaRef}
                  placeholder="Leave a comment…"
                  className="text-foreground bg-background min-h-[60px] w-full resize-none rounded-md border p-2 text-sm focus:ring-2 focus:ring-offset-[-1px]"
                />
                <div className="mt-1 flex items-center gap-2">
                  <Button
                    size="sm"
                    className="cursor-pointer"
                    onClick={handleSubmit}
                  >
                    Comment
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCancel}
                    variant="outline"
                    style={{
                      boxShadow: 'none',
                      color: 'var(--color-foreground)',
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// The persisted form of a submitted CommentForm: a single-message thread
// showing the typed text. Delete removes the owning annotation.
export function CommentThread({
  body,
  onDelete,
}: {
  body: string;
  onDelete: () => void;
}) {
  return (
    <div
      className="max-w-[95%] sm:max-w-[70%]"
      style={{
        whiteSpace: 'normal',
        margin: 10,
        fontFamily: 'Geist',
      }}
    >
      <div className="bg-card rounded-lg border p-3 shadow-[0_2px_4px_rgba(0,0,0,0.05)]">
        <div className="flex gap-2">
          <div className="relative -mt-0.5 flex-shrink-0">
            <Avatar className="h-6 w-6">
              <AvatarImage src="/avatars/avatar_fat.jpg" alt="You" />
              <AvatarFallback>Y</AvatarFallback>
            </Avatar>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-foreground font-semibold">You</span>
              <span className="text-muted-foreground text-sm">just now</span>
            </div>
            <p className="text-foreground leading-relaxed whitespace-pre-wrap">
              {body}
            </p>
          </div>
        </div>

        <div className="mt-2 ml-8 flex items-center gap-4">
          <button
            onClick={onDelete}
            className="text-sm text-red-600 transition-colors hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// Delete is optional so the thread can render in read-only contexts; when
// provided it removes the owning annotation.
export function ExampleThread({ onDelete }: { onDelete?: () => void }) {
  return (
    <div
      className="max-w-[95%] sm:max-w-[70%]"
      style={{
        whiteSpace: 'normal',
        margin: 10,
        fontFamily: 'Geist',
      }}
    >
      <div className="bg-card rounded-lg border p-3 shadow-[0_2px_4px_rgba(0,0,0,0.05)]">
        <div className="flex gap-2">
          <div className="relative -mt-0.5 flex-shrink-0">
            <Avatar className="h-6 w-6">
              <AvatarImage src="/avatars/avatar_fat.jpg" alt="Author" />
              <AvatarFallback>A</AvatarFallback>
            </Avatar>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-foreground font-semibold">Alex</span>
              <span className="text-muted-foreground text-sm">2h ago</span>
            </div>
            <p className="text-foreground leading-relaxed">
              Should we add rate limiting to this endpoint? We might want to
              prevent abuse.
            </p>
          </div>
        </div>

        <div className="mt-4 ml-8 space-y-4">
          <div className="flex gap-2">
            <div className="relative -mt-0.5 flex-shrink-0">
              <Avatar className="h-6 w-6">
                <AvatarImage src="/avatars/avatar_mdo.jpg" alt="Author" />
                <AvatarFallback>M</AvatarFallback>
              </Avatar>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-foreground font-semibold">Mark</span>
                <span className="text-muted-foreground text-sm">1h ago</span>
              </div>
              <p className="text-foreground leading-relaxed">
                Good idea! I'll add that in a follow-up PR.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 ml-8 flex items-center gap-4">
          <button className="flex items-center gap-1.5 text-sm text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            Add reply…
          </button>
          <button className="text-sm text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            Resolve
          </button>
          {onDelete != null && (
            <button
              onClick={onDelete}
              className="text-sm text-red-600 transition-colors hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
