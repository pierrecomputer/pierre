'use client';

import {
  IconBookmark,
  IconBug,
  IconComment,
  IconCopyFill,
} from '@/components/icons';
import type { AnnotationSide } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

// =============================================================================
// Main Component
// =============================================================================

interface HoverActionsProps {
  prerenderedDiff: PreloadFileDiffResult<undefined>;
}

interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'info';
}

interface HoveredLine {
  lineNumber: number;
  side: AnnotationSide;
}

export function HoverActions({ prerenderedDiff }: HoverActionsProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [nextId, setNextId] = useState(0);
  const [hoveredLine, setHoveredLine] = useState<HoveredLine | null>(null);

  const addToast = (text: string, type: 'success' | 'info' = 'info') => {
    const id = nextId;
    setNextId((n) => n + 1);
    setToasts((t) => [...t, { id, text, type }]);
    setTimeout(() => {
      setToasts((t) => t.filter((toast) => toast.id !== id));
    }, 2000);
  };

  const lineInfo =
    hoveredLine != null
      ? hoveredLine.side === 'additions'
        ? `+${hoveredLine.lineNumber}`
        : hoveredLine.side === 'deletions'
          ? `-${hoveredLine.lineNumber}`
          : `${hoveredLine.lineNumber}`
      : '';

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-medium">Hover Actions</h2>
        <p className="text-muted-foreground">
          Use <code>onLineEnter</code> and <code>onLineLeave</code> callbacks to
          track hover state, then render contextual actions with{' '}
          <code>renderHoverUtility</code>. Perfect for code review workflows
          with comment, bookmark, and bug report actions.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-neutral-800">
        <FileDiff
          {...prerenderedDiff}
          options={{
            ...prerenderedDiff.options,
            enableHoverUtility: true,
            onLineEnter: ({ lineNumber, annotationSide }) => {
              setHoveredLine({ lineNumber, side: annotationSide });
            },
            onLineLeave: () => {
              setHoveredLine(null);
            },
          }}
          renderHoverUtility={() => {
            if (hoveredLine == null) return null;

            return (
              <div
                className="flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl"
                style={{
                  fontFamily: 'system-ui, sans-serif',
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                <ActionButton
                  icon={<IconCopyFill size={12} />}
                  label="Copy line"
                  onClick={() => addToast(`Copied line ${lineInfo}`, 'success')}
                />
                <ActionButton
                  icon={<IconComment size={12} />}
                  label="Add comment"
                  onClick={() =>
                    addToast(`Comment on line ${lineInfo}`, 'info')
                  }
                />
                <ActionButton
                  icon={<IconBookmark size={12} />}
                  label="Bookmark"
                  onClick={() =>
                    addToast(`Bookmarked line ${lineInfo}`, 'success')
                  }
                />
                <ActionButton
                  icon={<IconBug size={12} />}
                  label="Report issue"
                  onClick={() =>
                    addToast(`Bug report for line ${lineInfo}`, 'info')
                  }
                />
              </div>
            );
          }}
        />

        {/* Toast container */}
        <div className="pointer-events-none absolute right-4 bottom-4 space-y-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`animate-in slide-in-from-right-5 fade-in rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${
                toast.type === 'success'
                  ? 'bg-green-900 text-green-200'
                  : 'bg-blue-900 text-blue-200'
              }`}
            >
              {toast.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Action Button
// =============================================================================

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}
