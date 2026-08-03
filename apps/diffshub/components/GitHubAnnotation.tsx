import type { CodeViewLineSelection, DiffLineAnnotation } from '@pierre/diffs';
import { IconShare } from '@pierre/icons';
import { memo } from 'react';

import { CommentAuthorAvatar } from './CommentAuthorAvatar';
import { annotationCardBase } from '@/lib/annotation';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import type { GitHubCommentWire } from '@/lib/githubComments';
import type { GitHubCommentMetadata } from '@/lib/types';

interface GitHubAnnotationProps {
  annotation: DiffLineAnnotation<GitHubCommentMetadata>;
  itemId: string;
  onToggleSelection(selection: CodeViewLineSelection): void;
}

// Renders a GitHub comment thread inline in the diff: the root comment plus
// its replies in one card. Clicking the card toggles the anchored line
// selection, mirroring the local comment card; file-level threads have no
// lines to select and render as a plain card.
export const GitHubAnnotation = memo(function GitHubAnnotation({
  annotation,
  itemId,
  onToggleSelection,
}: GitHubAnnotationProps) {
  const { range, thread } = annotation.metadata;
  const selection = range == null ? undefined : { id: itemId, range };
  const toggleSelection =
    selection == null ? undefined : () => onToggleSelection(selection);
  return (
    <div
      role={toggleSelection == null ? undefined : 'button'}
      tabIndex={toggleSelection == null ? undefined : 0}
      className={cn(
        annotationCardBase,
        'flex-col',
        toggleSelection != null &&
          'cursor-pointer hover:border-[var(--diffshub-annotation-hover-border,var(--diffshub-annotation-border,var(--color-border)))]'
      )}
      onClick={toggleSelection}
      onKeyDown={(event) => {
        if (
          toggleSelection == null ||
          (event.key !== 'Enter' && event.key !== ' ')
        ) {
          return;
        }
        event.preventDefault();
        toggleSelection();
      }}
    >
      <GitHubThreadComment comment={thread.root} />
      {thread.replies.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2.5 border-t border-[var(--diffshub-annotation-border,var(--color-border))] pt-2.5">
          {thread.replies.map((reply) => (
            <GitHubThreadComment key={reply.id} comment={reply} />
          ))}
        </div>
      )}
    </div>
  );
});

// One comment of a GitHub thread: avatar, author, relative timestamp, an
// open-on-GitHub link, and the body. Shared between the inline annotation
// card and the sidebar's expanded view of threads without an inline card.
export function GitHubThreadComment({
  comment,
}: {
  comment: GitHubCommentWire;
}) {
  const timestamp = formatRelativeTime(comment.createdAt);
  return (
    <div className="flex gap-2.5">
      <CommentAuthorAvatar
        seed={comment.author.login}
        avatarUrl={comment.author.avatarUrl}
        className="size-6"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <strong className="text-[14px]">{comment.author.login}</strong>
          {timestamp != null && (
            <span className="text-muted-foreground text-[12px]">
              {timestamp}
            </span>
          )}
          {comment.htmlUrl != null && (
            <a
              href={comment.htmlUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open comment on GitHub"
              title="Open comment on GitHub"
              className="text-muted-foreground hover:text-foreground ml-auto self-center"
              onClick={(event) => event.stopPropagation()}
            >
              <IconShare className="size-3" />
            </a>
          )}
        </div>
        <p className="m-0 text-[14px] break-words whitespace-pre-wrap">
          {comment.body}
        </p>
      </div>
    </div>
  );
}
