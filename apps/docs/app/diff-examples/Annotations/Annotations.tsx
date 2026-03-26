'use client';

import {
  type AnnotationSide,
  type DiffLineAnnotation,
  type SelectedLineRange,
} from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { IconArrowDownRight } from '@pierre/icons';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { type AnnotationMetadata } from './constants';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

interface AnnotationsProps {
  prerenderedDiff: PreloadMultiFileDiffResult<AnnotationMetadata>;
}

export function Annotations({ prerenderedDiff }: AnnotationsProps) {
  const [annotations, setAnnotations] = useState<
    DiffLineAnnotation<AnnotationMetadata>[]
  >(prerenderedDiff.annotations ?? []);

  const addCommentAtLine = useCallback(
    (side: AnnotationSide, lineNumber: number) => {
      setAnnotations((prev) => {
        const hasAnnotation = prev.some(
          (ann) => ann.side === side && ann.lineNumber === lineNumber
        );

        if (hasAnnotation) return prev;

        return [
          ...prev,
          {
            side,
            lineNumber,
            metadata: {
              key: `${side}-${lineNumber}`,
              isThread: false,
            },
          },
        ];
      });
    },
    []
  );

  const hasOpenCommentForm = annotations.some((ann) => !ann.metadata.isThread);
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(
    null
  );

  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
      if (range == null) return;
      const derivedSide = range.endSide ?? range.side;
      const side: AnnotationSide =
        derivedSide === 'deletions' ? 'deletions' : 'additions';
      addCommentAtLine(side, Math.max(range.end, range.start));
    },
    [addCommentAtLine]
  );

  const handleSubmitComment = useCallback(
    (side: AnnotationSide, lineNumber: number) => {
      // TODO: Implement
      console.log('submit comment', side, lineNumber);
    },
    []
  );

  const handleCancelComment = useCallback(
    (side: AnnotationSide, lineNumber: number) => {
      setAnnotations((prev) =>
        prev.filter(
          (ann) => !(ann.side === side && ann.lineNumber === lineNumber)
        )
      );
      setSelectedRange(null);
    },
    []
  );

  return (
    <div className="space-y-5">
      <FeatureHeader
        id="annotations"
        title="Comments & Annotations"
        description={
          <>
            <code>@pierre/diffs</code> provide a flexible annotation framework
            for injecting additional content and context. Use it to render your
            own line comments, annotations from CI jobs, and other third-party
            content.
          </>
        }
      />
      <MultiFileDiff
        {...prerenderedDiff}
        className="diff-container"
        selectedLines={selectedRange}
        options={{
          ...prerenderedDiff.options,
          enableLineSelection: !hasOpenCommentForm,
          enableGutterUtility: !hasOpenCommentForm,
          onLineSelectionEnd: handleLineSelectionEnd,
        }}
        lineAnnotations={annotations}
        renderAnnotation={(annotation) =>
          annotation.metadata.isThread ? (
            <Thread />
          ) : (
            <CommentForm
              side={annotation.side}
              lineNumber={annotation.lineNumber}
              onSubmit={handleSubmitComment}
              onCancel={handleCancelComment}
            />
          )
        }
      />
    </div>
  );
}

function CommentForm({
  side,
  lineNumber,
  onSubmit,
  onCancel,
}: {
  side: AnnotationSide;
  lineNumber: number;
  onSubmit: (side: AnnotationSide, lineNumber: number) => void;
  onCancel: (side: AnnotationSide, lineNumber: number) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, []);

  const handleSubmit = useCallback(() => {
    onSubmit(side, lineNumber);
  }, [side, lineNumber, onSubmit]);

  const handleCancel = useCallback(() => {
    onCancel(side, lineNumber);
  }, [side, lineNumber, onCancel]);

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
            margin: 20,
            fontFamily: 'Geist',
          }}
        >
          <div className="bg-card rounded-lg border p-5 shadow-sm">
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
                  placeholder="Leave a comment"
                  className="text-foreground bg-background focus:ring-ring min-h-[60px] w-full resize-none rounded-md border p-2 text-sm focus:ring-2 focus:outline-none"
                />
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    className="cursor-pointer"
                    onClick={handleSubmit}
                  >
                    Comment
                  </Button>
                  <button
                    onClick={handleCancel}
                    className="text-muted-foreground hover:text-foreground cursor-pointer px-3 py-1 text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Thread() {
  return (
    <div
      className="max-w-[95%] sm:max-w-[70%]"
      style={{
        whiteSpace: 'normal',
        margin: 20,
        fontFamily: 'Geist',
      }}
    >
      <CommentThread
        mainComment={{
          author: 'You',
          timestamp: '3h',
          content:
            'Should we validate the role parameter? We could restrict it to a set of allowed values.',
          avatarUrl: '/avatars/avatar_fat.jpg',
          isYou: true,
        }}
        replies={[
          {
            author: 'Amadeus',
            timestamp: '2h',
            content: 'Good idea, maybe use a Literal type or an enum.',
            avatarUrl: '/avatars/avatar_amadeus.jpg',
          },
          {
            author: 'Mark',
            timestamp: '2h',
            content:
              'Agreed, we should also update verify_token to return the role.',
            avatarUrl: '/avatars/avatar_mdo.jpg',
          },
        ]}
        onAddReply={() => console.log('Add reply clicked')}
        onResolve={() => console.log('Resolve clicked')}
      />
    </div>
  );
}

interface CommentProps {
  author: string;
  timestamp: string;
  content: string;
  avatarUrl?: string;
  isYou?: boolean;
}

export function Comment({
  author,
  timestamp,
  content,
  avatarUrl,
  isYou = false,
}: CommentProps) {
  return (
    <div className="flex gap-2">
      <div className="relative -mt-0.5 flex-shrink-0">
        <Avatar className="h-6 w-6">
          <AvatarImage src={avatarUrl ?? '/placeholder.svg'} alt={author} />
          <AvatarFallback>{author[0]}</AvatarFallback>
        </Avatar>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-foreground font-semibold">
            {isYou ? 'You' : author}
          </span>
          <span className="text-muted-foreground text-sm">{timestamp}</span>
        </div>
        <p className="text-foreground leading-relaxed">{content}</p>
      </div>
    </div>
  );
}

interface CommentThreadProps {
  mainComment: CommentProps;
  replies?: CommentProps[];
  onAddReply?: () => void;
  onResolve?: () => void;
}

export function CommentThread({
  mainComment,
  replies = [],
  onAddReply,
  onResolve,
}: CommentThreadProps) {
  return (
    <div className="bg-card rounded-lg border p-5 shadow-sm">
      <Comment {...mainComment} />

      {replies.length > 0 && (
        <div className="mt-4 ml-8 space-y-4 sm:ml-[32px]">
          {replies.map((reply, index) => (
            <Comment key={index} {...reply} />
          ))}
        </div>
      )}

      <div className="mt-4 ml-8 flex items-center gap-4 sm:ml-[32px]">
        <button
          onClick={onAddReply}
          className="flex items-center gap-1.5 text-sm text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          <IconArrowDownRight />
          Add reply...
        </button>
        <button
          onClick={onResolve}
          className="text-sm text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Resolve
        </button>
      </div>
    </div>
  );
}
