import type { CodeViewLineSelection, DiffLineAnnotation } from '@pierre/diffs';
import { IconShare } from '@pierre/icons';
import { memo, useState } from 'react';

import { CommentAuthorAvatar } from './CommentAuthorAvatar';
import { Button } from '@/components/Button';
import { annotationCardBase } from '@/lib/annotation';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import type {
  GitHubCommentUser,
  GitHubCommentWire,
} from '@/lib/githubComments';
import type { GitHubCommentMetadata } from '@/lib/types';

interface GitHubAnnotationProps {
  annotation: DiffLineAnnotation<GitHubCommentMetadata>;
  itemId: string;
  onPostReply?(rootCommentId: number, body: string): Promise<void>;
  onToggleSelection(selection: CodeViewLineSelection): void;
  replyAuthor?: GitHubCommentUser;
}

// Renders a GitHub comment thread inline in the diff: the root comment plus
// its replies in one card. Clicking the card toggles the anchored line
// selection, mirroring the local comment card; file-level threads have no
// lines to select and render as a plain card.
export const GitHubAnnotation = memo(function GitHubAnnotation({
  annotation,
  itemId,
  onPostReply,
  onToggleSelection,
  replyAuthor,
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
      {onPostReply != null && (
        <GitHubReplyForm
          author={replyAuthor}
          onPostReply={(body) => onPostReply(thread.root.id, body)}
        />
      )}
    </div>
  );
});

function GitHubReplyForm({
  author,
  onPostReply,
}: {
  author?: GitHubCommentUser;
  onPostReply(body: string): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const trimmedBody = body.trim();

  function submit() {
    if (trimmedBody === '' || pending) {
      return;
    }
    setPending(true);
    onPostReply(trimmedBody)
      .then(() => {
        setBody('');
        setOpen(false);
      })
      .catch(() => {})
      .finally(() => setPending(false));
  }

  const avatar =
    author != null ? (
      <CommentAuthorAvatar
        seed={author.login}
        avatarUrl={author.avatarUrl}
        className="size-6"
      />
    ) : null;

  if (!open) {
    return (
      <div className="mt-2.5 flex items-center gap-2.5 border-t border-[var(--diffshub-annotation-border,var(--color-border))] pt-2.5">
        {avatar}
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground min-w-0 flex-1 cursor-text rounded-lg border border-[var(--diffshub-annotation-border,var(--color-border))] px-3 py-1.5 text-left text-[13px]"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
        >
          Write a reply
        </button>
      </div>
    );
  }

  return (
    <div
      className="mt-2.5 flex flex-col gap-1.5 border-t border-[var(--diffshub-annotation-border,var(--color-border))] pt-2.5"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex w-full gap-2.5">
        {avatar}
        <textarea
          value={body}
          disabled={pending}
          autoFocus
          onChange={({ currentTarget }) => setBody(currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              return;
            }
            if ((event.metaKey || event.shiftKey) && event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Write a reply"
          rows={2}
          className="field-sizing-content min-w-0 flex-1 resize-none rounded-lg border border-[var(--diffshub-annotation-border,var(--color-border))] bg-transparent px-3 py-1.5 text-[14px] text-inherit placeholder:text-[var(--diffshub-popover-muted-fg,var(--color-muted-foreground))] focus:border-blue-500 focus:outline-none disabled:opacity-60"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="muted"
          size="sm"
          disabled={pending}
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground font-normal hover:no-underline"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={trimmedBody === '' || pending}
          onClick={submit}
          className="bg-blue-500 hover:bg-blue-600"
        >
          {pending ? 'Posting…' : 'Reply'}
        </Button>
      </div>
    </div>
  );
}

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
        seed={comment.user.login}
        avatarUrl={comment.user.avatarUrl}
        className="size-6"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <strong className="text-[14px]">{comment.user.login}</strong>
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
