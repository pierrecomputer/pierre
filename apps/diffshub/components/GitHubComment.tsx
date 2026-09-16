import { useState } from 'react';

import { CommentAuthorAvatar } from './CommentAuthorAvatar';
import { Button } from '@/components/Button';
import { annotationCardBase } from '@/lib/annotation';
import type { GitHubCodeComment } from '@/lib/githubTypes';

interface GitHubCommentProps {
  comment: GitHubCodeComment;
  userId: number | undefined;
  onDelete(id: number): Promise<string | undefined>;
  onSelect?(): void;
}

/** Published comments link to their GitHub thread; only the author can delete. */
export function GitHubComment({
  comment,
  userId,
  onDelete,
  onSelect,
}: GitHubCommentProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const author = comment.author?.login ?? 'Deleted account';

  async function handleDelete() {
    if (!window.confirm('Delete this comment from GitHub?')) return;
    setDeleting(true);
    try {
      setError(await onDelete(comment.id));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className={annotationCardBase}>
      <CommentAuthorAvatar name={author} src={comment.author?.avatarUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <strong className="text-sm">{author}</strong>
        <p className="m-0 text-sm break-words whitespace-pre-wrap">
          {comment.body}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <a
            href={comment.url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            View on GitHub
          </a>
          {onSelect != null && (
            <Button variant="muted" size="sm" onClick={onSelect}>
              Show lines
            </Button>
          )}
          {comment.canDelete && comment.author?.id === userId && (
            <Button
              variant="muted"
              size="sm"
              disabled={deleting}
              onClick={() => {
                void handleDelete();
              }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
        </div>
        {error != null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
