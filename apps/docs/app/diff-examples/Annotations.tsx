'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type {
  AnnotationSide,
  DiffLineAnnotation,
  FileContents,
} from '@pierre/precision-diffs';
import { CornerDownRight, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FeatureHeader } from './FeatureHeader';

const OLD_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      <Header />
      <IconSprite />
    </div>
  );
}
`,
};

const NEW_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import IconSprite from './IconSprite';
import HeaderSimple from '../components/HeaderSimple';
import Hero from '../components/Hero';

export default function Home() {
  return (
    <div>
      <HeaderSimple />
      <IconSprite />
      <h1>Hello!</h1>
    </div>
  );
}
`,
};

interface AnnotationMetadata {
  key: string;
  isThread: boolean;
}

export function Annotations() {
  const [annotations, setAnnotations] = useState<
    DiffLineAnnotation<AnnotationMetadata>[]
  >([
    {
      side: 'additions',
      lineNumber: 8,
      metadata: {
        key: 'additions-8',
        isThread: true,
      },
    },
  ]);
  const [buttonPosition, setButtonPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [hoveredLine, setHoveredLine] = useState<{
    side: AnnotationSide;
    lineNumber: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleLineEnter = useCallback(
    (props: {
      lineElement: HTMLElement;
      annotationSide: AnnotationSide;
      lineNumber: number;
    }) => {
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
    [annotations]
  );

  const handleLineLeave = useCallback(() => {
    setButtonPosition(null);
    setHoveredLine(null);
  }, []);

  const handleContainerMouseLeave = useCallback(() => {
    setButtonPosition(null);
    setHoveredLine(null);
  }, []);

  const handleAddComment = useCallback(() => {
    if (hoveredLine != null) {
      setAnnotations((prev) => [
        ...prev,
        {
          side: hoveredLine.side,
          lineNumber: hoveredLine.lineNumber,
          metadata: {
            key: `${hoveredLine.side}-${hoveredLine.lineNumber}`,
            isThread: false, // Start as a form, not a thread yet
          },
        },
      ]);
      setButtonPosition(null);
      setHoveredLine(null);
    }
  }, [hoveredLine]);

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

  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Comments & Annotations"
        description="Precision Diffs provide a flexible annotation framework for injecting additional content and context into your diffs. Use it to render line comments, annotations from CI jobs, and other third party content."
      />
      <div
        ref={containerRef}
        style={{ position: 'relative' }}
        onMouseLeave={handleContainerMouseLeave}
      >
        {buttonPosition != null && (
          <Button
            size="icon-sm"
            variant="default"
            onClick={handleAddComment}
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
            <Plus className="h-4 w-4" />
          </Button>
        )}
        <FileDiff
          oldFile={OLD_FILE}
          newFile={NEW_FILE}
          className="rounded-lg overflow-hidden border"
          options={{
            theme: 'pierre-dark',
            diffStyle: 'unified',
            onLineEnter: handleLineEnter,
            onLineLeave: handleLineLeave,
          }}
          annotations={annotations}
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
      <div className="rounded-lg border bg-card p-5 shadow-sm">
        <div className="flex gap-2">
          <div className="relative flex-shrink-0 -mt-0.5">
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
              className="w-full min-h-[60px] p-2 text-sm text-foreground bg-background border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-ring"
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
                className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1 cursor-pointer"
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
      <div className="relative flex-shrink-0 -mt-0.5">
        <Avatar className="h-6 w-6">
          <AvatarImage src={avatarUrl ?? '/placeholder.svg'} alt={author} />
          <AvatarFallback>{author[0]}</AvatarFallback>
        </Avatar>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-foreground">
            {isYou ? 'You' : author}
          </span>
          <span className="text-sm text-muted-foreground">{timestamp}</span>
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
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <Comment {...mainComment} />

      {replies.length > 0 && (
        <div className="mt-4 ml-8 sm:ml-[32px] space-y-4">
          {replies.map((reply, index) => (
            <Comment key={index} {...reply} />
          ))}
        </div>
      )}

      <div className="mt-4 ml-8 sm:ml-[32px] flex items-center gap-4">
        <button
          onClick={onAddReply}
          className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          <CornerDownRight className="h-4 w-4" />
          Add reply...
        </button>
        <button
          onClick={onResolve}
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          Resolve
        </button>
      </div>
    </div>
  );
}
