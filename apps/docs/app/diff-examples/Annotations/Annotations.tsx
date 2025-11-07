'use client';

import { IconArrowDownRight, IconPlus } from '@/components/icons/icons';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type {
  AnnotationSide,
  DiffLineAnnotation,
} from '@pierre/precision-diffs';
import { MultiFileDiff } from '@pierre/precision-diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/precision-diffs/ssr';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import {
  ACCEPT_REJECT_ANNOTATIONS,
  ACCEPT_REJECT_EXAMPLE,
  ACCEPT_REJECT_NEW_FILE,
  ACCEPT_REJECT_OLD_FILE,
  type AcceptRejectMetadata,
  type AnnotationMetadata,
} from './constants';

interface AnnotationsProps {
  prerenderedDiff: PreloadMultiFileDiffResult<AnnotationMetadata>;
}

export function Annotations({ prerenderedDiff }: AnnotationsProps) {
  const [annotations, setAnnotations] = useState<
    DiffLineAnnotation<AnnotationMetadata>[]
  >(prerenderedDiff.annotations ?? []);
  const [buttonPosition, setButtonPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [hoveredLine, setHoveredLine] = useState<{
    side: AnnotationSide;
    lineNumber: number;
  } | null>(null);
  const [selectedLines, setSelectedLines] = useState<{
    first: number;
    last: number;
    side?: AnnotationSide | 'both';
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedLinesRef = useRef<typeof selectedLines>(null);
  const isSelectingRef = useRef(false);
  const selectionAnchorRef = useRef<{
    side: AnnotationSide;
    lineNumber: number;
  } | null>(null);
  const selectionEndRef = useRef<{
    side: AnnotationSide;
    lineNumber: number;
  } | null>(null);
  const hasSelectionRangeRef = useRef(false);

  const updateSelectedLines = useCallback(
    (
      range:
        | { first: number; last: number; side?: AnnotationSide | 'both' }
        | null
    ) => {
      selectedLinesRef.current = range;
      setSelectedLines(range);
    },
    []
  );

  const addCommentAtLine = useCallback(
    (side: AnnotationSide, lineNumber: number) => {
      let added = false;
      setAnnotations((prev) => {
        const hasAnnotation = prev.some(
          (ann) => ann.side === side && ann.lineNumber === lineNumber
        );

        if (hasAnnotation) return prev;

        added = true;
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

      if (added) {
        setButtonPosition(null);
        setHoveredLine(null);

        const currentSelection = selectedLinesRef.current;
        if (currentSelection != null) {
          updateSelectedLines({
            first: currentSelection.first,
            last: currentSelection.last,
            side: currentSelection.side,
          });
        }
      }
    },
    [updateSelectedLines]
  );

  const handleSelectionMouseUp = useCallback(() => {
    if (!isSelectingRef.current) return;

    window.removeEventListener('mouseup', handleSelectionMouseUp);
    isSelectingRef.current = false;

    const hadSelection = hasSelectionRangeRef.current;
    hasSelectionRangeRef.current = false;

    const anchor = selectionAnchorRef.current;
    const end = selectionEndRef.current;

    selectionAnchorRef.current = null;
    selectionEndRef.current = null;

    if (!hadSelection) {
      updateSelectedLines(null);
      return;
    }

    const range = selectedLinesRef.current;
    if (range == null) {
      updateSelectedLines(null);
      return;
    }

    const bottomLineNumber = range.last;
    let bottomSide: AnnotationSide | undefined;

    if (end?.lineNumber === bottomLineNumber) {
      bottomSide = end.side;
    } else if (anchor?.lineNumber === bottomLineNumber) {
      bottomSide = anchor.side;
    } else if (end != null) {
      bottomSide = end.side;
    } else if (anchor != null) {
      bottomSide = anchor.side;
    }

    if (bottomSide == null && range.side != null && range.side !== 'both') {
      bottomSide = range.side;
    }

    if (bottomSide == null) return;

    addCommentAtLine(bottomSide, bottomLineNumber);
  }, [addCommentAtLine, updateSelectedLines]);

  useEffect(() => {
    return () => {
      window.removeEventListener('mouseup', handleSelectionMouseUp);
    };
  }, [handleSelectionMouseUp]);

  const handleLineEnter = useCallback(
    (props: {
      lineElement: HTMLElement;
      annotationSide: AnnotationSide;
      lineNumber: number;
    }) => {
      if (isSelectingRef.current) {
        const anchor = selectionAnchorRef.current;
        if (anchor == null) return;

        const { annotationSide, lineNumber } = props;
        hasSelectionRangeRef.current = true;
        selectionEndRef.current = { side: annotationSide, lineNumber };

        const first = Math.min(anchor.lineNumber, lineNumber);
        const last = Math.max(anchor.lineNumber, lineNumber);

        updateSelectedLines({ first, last, side: anchor.side });
        return;
      }

      const lineElement = props.lineElement;
      const container = containerRef.current;

      if (container == null) return;

      const { annotationSide, lineNumber } = props;

      // Don't show button if there's already an annotation on this line
      const hasAnnotation = annotations.some(
        (ann) => ann.side === annotationSide && ann.lineNumber === lineNumber
      );

      if (hasAnnotation) {
        setButtonPosition(null);
        setHoveredLine(null);
        return;
      }

      // Get the position of the line element relative to the container
      const containerRect = container.getBoundingClientRect();
      const lineRect = lineElement.getBoundingClientRect();

      setButtonPosition({
        top: lineRect.top - containerRect.top + lineRect.height / 2,
        left: 16, // Fixed position from left edge
      });

      setHoveredLine({ side: annotationSide, lineNumber });
    },
    [annotations, updateSelectedLines]
  );

  const handleContainerMouseLeave = useCallback(() => {
    if (isSelectingRef.current) return;
    setButtonPosition(null);
    setHoveredLine(null);
  }, []);

  const handleAddComment = useCallback(() => {
    if (hoveredLine != null) {
      addCommentAtLine(hoveredLine.side, hoveredLine.lineNumber);
    }
  }, [hoveredLine, addCommentAtLine]);

  const handlePlusMouseDown = useCallback(() => {
    if (hoveredLine == null || isSelectingRef.current) return;

    isSelectingRef.current = true;
    hasSelectionRangeRef.current = false;
    const anchor = {
      side: hoveredLine.side,
      lineNumber: hoveredLine.lineNumber,
    };
    selectionAnchorRef.current = anchor;
    selectionEndRef.current = anchor;

    window.addEventListener('mouseup', handleSelectionMouseUp);
    updateSelectedLines({
      first: anchor.lineNumber,
      last: anchor.lineNumber,
      side: anchor.side,
    });
  }, [handleSelectionMouseUp, hoveredLine]);

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
    },
    []
  );

  console.log('selectedLines', selectedLines);

  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Comments & Annotations"
        description="Precision Diffs provide a flexible annotation framework for injecting additional content and context. Use it to render your own line comments, annotations from CI jobs, and other third-party content."
      />
      <div
        ref={containerRef}
        className="relative flex flex-col gap-3"
        onMouseLeave={handleContainerMouseLeave}
      >
        {buttonPosition != null && (
          <Button
            size="icon-sm"
            variant="default"
            onClick={handleAddComment}
            onMouseDown={handlePlusMouseDown}
            style={{
              position: 'absolute',
              top: buttonPosition.top,
              left: buttonPosition.left + 4,
              transform: 'translateY(-50%)',
              zIndex: 10,
              backgroundColor: '#1a76d4',
              transition: 'none',
              cursor: 'pointer',
            }}
          >
            <IconPlus />
          </Button>
        )}
        <MultiFileDiff
          {...prerenderedDiff}
          className="diff-container"
          enableLineSelection={true}
          selectedLines={selectedLines}
          onLineSelected={updateSelectedLines}
          options={{
            ...prerenderedDiff.options,
            onLineEnter: handleLineEnter,
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
              <AvatarImage
                src="https://db.heypierre.app/storage/v1/object/public/avatars/i8UHRtQf_400x400.jpg"
                alt="You"
              />
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
            'Good lord, I refuse to look at diffs ever again after this.',
          avatarUrl:
            'https://db.heypierre.app/storage/v1/object/public/avatars/i8UHRtQf_400x400.jpg',
          isYou: true,
        }}
        replies={[
          {
            author: 'Amadeus',
            timestamp: '2h',
            content: 'Wait, how long have we been working on this?',
            avatarUrl:
              'https://db.heypierre.app/storage/v1/object/public/avatars/Evzotboe_400x400.jpg',
          },
          {
            author: 'Mark',
            timestamp: '2h',
            content: '*checks notes*… it’s not been a short amount of time.',
            avatarUrl:
              'https://db.heypierre.app/storage/v1/object/public/avatars/BET9cPgr_400x400.jpg',
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

interface AcceptRejectExampleProps {
  prerenderedDiff: PreloadMultiFileDiffResult<AcceptRejectMetadata>;
}

export function AcceptRejectExample({
  prerenderedDiff,
}: AcceptRejectExampleProps) {
  const [annotationState, setAnnotationState] = useState<
    'accepted' | 'rejected' | 'pending'
  >('pending');

  const preloadedAnnotations =
    prerenderedDiff.annotations ?? ACCEPT_REJECT_ANNOTATIONS;

  const {
    annotations: _ignoredAnnotations,
    prerenderedHTML,
    options,
    ...rest
  } = prerenderedDiff;

  const resolvedOldFile =
    annotationState === 'pending'
      ? ACCEPT_REJECT_OLD_FILE
      : annotationState === 'accepted'
        ? ACCEPT_REJECT_NEW_FILE
        : ACCEPT_REJECT_OLD_FILE;

  const resolvedNewFile =
    annotationState === 'pending'
      ? ACCEPT_REJECT_NEW_FILE
      : annotationState === 'accepted'
        ? ACCEPT_REJECT_NEW_FILE
        : ACCEPT_REJECT_OLD_FILE;

  const activeAnnotations =
    annotationState === 'pending' ? preloadedAnnotations : [];

  const diffOptions = options ??
    ACCEPT_REJECT_EXAMPLE.options ?? {
      theme: 'pierre-dark',
      diffStyle: 'unified',
      expandUnchanged: true,
    };

  const fileDiffProps =
    annotationState === 'pending'
      ? {
          ...rest,
          prerenderedHTML,
          options: diffOptions,
        }
      : {
          ...rest,
          oldFile: resolvedOldFile,
          newFile: resolvedNewFile,
          options: diffOptions,
        };

  const handleAccept = useCallback(() => {
    setAnnotationState('accepted');
  }, []);

  const handleReject = useCallback(() => {
    setAnnotationState('rejected');
  }, []);

  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Accept/Reject Changes"
        description="Annotations can also be used to build interactive code review interfaces similar to AI-assisted coding tools like Cursor. Use it to track the state of each change, inject custom UI like accept/reject buttons, and provide immediate visual feedback."
      />
      <MultiFileDiff
        {...fileDiffProps}
        className="diff-container"
        lineAnnotations={activeAnnotations}
        renderAnnotation={() => {
          return (
            <div
              style={{
                position: 'relative',
                zIndex: 10,
                width: '100%',
                backgroundColor: 'red',
                overflow: 'visible',
                fontFamily: 'Geist',
              }}
            >
              <div className="absolute top-1 right-8 flex gap-1">
                <Button
                  variant="muted"
                  size="xs"
                  className="rounded-[4px]"
                  onClick={handleReject}
                >
                  Undo{' '}
                  <span className="-ml-0.5 font-normal opacity-80">⌘N</span>
                </Button>
                <Button
                  variant="success"
                  size="xs"
                  className="rounded-[4px] text-black dark:text-black"
                  onClick={handleAccept}
                >
                  Keep{' '}
                  <span className="-ml-0.5 font-normal opacity-40">⌘Y</span>
                </Button>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}
