'use client';

import type { AnnotationSide } from '@pierre/diffs';
import { IconConvoFill, IconPlus } from '@pierre/icons';
import { memo, type MouseEvent } from 'react';

import { CommentAuthorAvatar } from './CommentAuthorAvatar';
import { cn } from '@/lib/cn';
import type {
  CommentLineType,
  DiffsHubSavedCommentEntry,
  DiffsHubSavedCommentItem,
} from '@/lib/types';

interface DiffsHubCommentsListProps {
  commentSections: readonly DiffsHubSavedCommentItem[];
  onSelectComment?(comment: DiffsHubSavedCommentEntry): void;
  onSelectItem?(itemId: string): void;
}

function getCommentLineLabel(
  side: AnnotationSide,
  lineNumber: number,
  lineType: CommentLineType
): string {
  if (lineType === 'context') {
    return `Line ${lineNumber}`;
  }
  const sigil = side === 'additions' ? '+' : '-';
  return `Line ${sigil}${lineNumber}`;
}

function getCommentLineClassName(
  side: AnnotationSide,
  lineType: CommentLineType
): string {
  if (lineType === 'context') {
    return 'text-muted-foreground';
  }
  // The themed chrome sets --diffshub-comment-add-fg / -del-fg with a shade
  // chosen from the active Shiki surface's luminance, so addition/deletion
  // labels stay legible even on mixed-palette themes (e.g. slack-ochin's
  // "light" classification with a dark navy sidebar, where the global
  // `dark:` variant would otherwise leave us with low-contrast 700 shades
  // on a dark card). The Tailwind shades stay as fallbacks for the
  // first-render window before the chrome style applies.
  return side === 'additions'
    ? 'text-[var(--diffshub-comment-add-fg,#047857)] dark:text-[var(--diffshub-comment-add-fg,#34d399)]'
    : 'text-[var(--diffshub-comment-del-fg,#be123c)] dark:text-[var(--diffshub-comment-del-fg,#fb7185)]';
}

// Wraps a click handler so users can drag-select text inside the row without
// also triggering navigation. mouseup after a selection fires click on the
// button; bail out only when the resulting selection is anchored inside this
// row, so a pre-existing selection elsewhere on the page (e.g. in the diff
// viewer) does not block keyboard/mouse activation of the row.
function handleRowClick(
  event: MouseEvent<HTMLButtonElement>,
  run: () => void
): void {
  if (event.button !== 0) {
    return;
  }
  const selection =
    typeof window !== 'undefined' ? window.getSelection() : null;
  if (selection != null && selection.toString().length > 0) {
    const row = event.currentTarget;
    const anchorInRow =
      selection.anchorNode != null && row.contains(selection.anchorNode);
    const focusInRow =
      selection.focusNode != null && row.contains(selection.focusNode);
    if (anchorInRow || focusInRow) {
      event.preventDefault();
      return;
    }
  }
  run();
}

export const DiffsHubCommentsList = memo(function DiffsHubCommentsList({
  commentSections,
  onSelectComment,
  onSelectItem,
}: DiffsHubCommentsListProps) {
  if (commentSections.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full min-h-0 flex-col items-center justify-center gap-2 px-7 text-center text-sm">
        <IconConvoFill size={24} className="mb-2" />
        <div className="flex flex-col">
          <strong className="font-medium">No comments yet</strong>
          <p>
            Hover over a line and click the{' '}
            <span className="light:text-white light:bg-[rgb(0,159,255)] inline-flex h-[20px] w-[20px] items-center justify-center rounded-[4px] align-top dark:bg-[rgb(0,159,255)] dark:text-black">
              <IconPlus />
            </span>{' '}
            button to add fake code comments.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'cv-mini-scrollbar',
        'h-full min-h-0 overflow-auto overscroll-contain pl-3 pb-3 pr-[max(0px,calc(12px-var(--cv-mini-gutter-vertical)))]'
      )}
    >
      {commentSections.map((section) => (
        <section key={section.itemId}>
          {onSelectItem != null ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring block w-full cursor-pointer p-3 pb-2 text-left text-sm font-medium break-all outline-none focus-visible:ring-2"
              onClick={(event) =>
                handleRowClick(event, () => onSelectItem(section.itemId))
              }
            >
              <span className="select-text">{section.path}</span>
            </button>
          ) : (
            <div className="text-muted-foreground p-3 pb-2 text-sm font-medium break-all">
              {section.path}
            </div>
          )}
          <div className="rounded-lg border border-[var(--diffshub-card-border,rgb(0_0_0_/_0.1))] dark:border-[var(--diffshub-card-border,rgb(255_255_255_/_0.15))]">
            {section.comments.map((comment) => (
              <button
                key={comment.key}
                type="button"
                // Card surface, hover, and border come from the themed
                // chrome (set on the sidebar wrapper) so cards stay
                // on-palette for mixed-light/dark themes like slack-ochin
                // (light-typed but uses a dark navy sidebar). The
                // hardcoded fallbacks cover the brief window before the
                // Shiki theme resolves on first render.
                // No `transition-colors` here: the bg / border / text
                // colors are driven by CSS variables that flip the entire
                // chrome on every theme swap, so a smooth color transition
                // on each card visibly trails the rest of the UI (header,
                // file tree, diff body) which snap instantly. Hover bg is
                // snappy enough without an interpolated transition.
                className="focus-visible:ring-ring flex w-full cursor-pointer items-start gap-2 border-b border-[var(--diffshub-card-border,rgb(0_0_0_/_0.1))] bg-[var(--diffshub-card-bg,var(--color-card))] p-3 text-left text-sm outline-none first:rounded-t-lg last:rounded-b-lg last:border-b-0 hover:bg-[var(--diffshub-card-hover-bg,var(--color-muted))] focus-visible:ring-2 dark:border-[var(--diffshub-card-border,rgb(255_255_255_/_0.15))]"
                onClick={(event) =>
                  handleRowClick(event, () => onSelectComment?.(comment))
                }
              >
                <CommentAuthorAvatar seed={comment.author} className="size-5" />
                <div className="flex flex-col items-start gap-0.5 select-text">
                  <div className="text-muted-foreground flex gap-1">
                    {comment.author} commented on{' '}
                    <span
                      className={cn(
                        getCommentLineClassName(comment.side, comment.lineType),
                        'font-medium'
                      )}
                    >
                      {getCommentLineLabel(
                        comment.side,
                        comment.lineNumber,
                        comment.lineType
                      )}
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
