'use client';

import { IconCheck, IconSparkle, IconX } from '@/components/icons';
import { FileDiff } from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import type { AIAnnotation } from './constants';

// =============================================================================
// Main Component
// =============================================================================

interface AICodeReviewProps {
  prerenderedDiff: PreloadFileDiffResult<AIAnnotation>;
}

export function AICodeReview({ prerenderedDiff }: AICodeReviewProps) {
  const [annotations, setAnnotations] = useState(
    prerenderedDiff.annotations ?? []
  );
  const [resolvedCount, setResolvedCount] = useState(0);

  const handleResolve = (lineNumber: number) => {
    setAnnotations((prev) => prev.filter((a) => a.lineNumber !== lineNumber));
    setResolvedCount((c) => c + 1);
  };

  const handleDismiss = (lineNumber: number) => {
    setAnnotations((prev) => prev.filter((a) => a.lineNumber !== lineNumber));
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <IconSparkle size={20} className="text-purple-400" />
          <h2 className="text-2xl font-medium">AI Code Review</h2>
        </div>
        <p className="text-muted-foreground">
          Use annotations to display inline AI suggestions, warnings, and code
          improvements. Each annotation can have custom actions like accept,
          dismiss, or apply fix.
        </p>
      </div>

      {annotations.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-purple-950/50 px-4 py-2 text-sm text-purple-300">
          <IconSparkle size={16} />
          <span>
            {annotations.length} suggestion{annotations.length !== 1 && 's'}{' '}
            remaining
            {resolvedCount > 0 && ` · ${resolvedCount} resolved`}
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <FileDiff
          {...prerenderedDiff}
          lineAnnotations={annotations}
          renderAnnotation={(annotation) => (
            <AIAnnotationCard
              annotation={annotation.metadata}
              onResolve={() => handleResolve(annotation.lineNumber)}
              onDismiss={() => handleDismiss(annotation.lineNumber)}
            />
          )}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Annotation Card
// =============================================================================

function AIAnnotationCard({
  annotation,
  onResolve,
  onDismiss,
}: {
  annotation: AIAnnotation;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const bgColor =
    annotation.type === 'warning'
      ? 'bg-amber-950/80 border-amber-800/50'
      : annotation.type === 'suggestion'
        ? 'bg-purple-950/80 border-purple-800/50'
        : 'bg-blue-950/80 border-blue-800/50';

  const iconColor =
    annotation.type === 'warning'
      ? 'text-amber-400'
      : annotation.type === 'suggestion'
        ? 'text-purple-400'
        : 'text-blue-400';

  return (
    <div className="p-4" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div className={`rounded-lg border p-4 ${bgColor}`}>
        <div className="flex items-start gap-3">
          <IconSparkle
            size={16}
            className={`mt-0.5 flex-shrink-0 ${iconColor}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-neutral-200">{annotation.message}</p>

            {annotation.suggestion && (
              <pre className="mt-3 overflow-x-auto rounded bg-black/30 p-3 text-xs text-neutral-300">
                <code>{annotation.suggestion}</code>
              </pre>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={onResolve}
                className="flex cursor-pointer items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-500"
              >
                <IconCheck size={12} />
                {annotation.suggestion ? 'Apply Fix' : 'Resolve'}
              </button>
              <button
                onClick={onDismiss}
                className="flex cursor-pointer items-center gap-1.5 rounded-md bg-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-600"
              >
                <IconX size={12} />
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
