import { useId, useRef, useState } from 'react';

import { Button } from './Button';
import { CommentForm } from './CommentForm';
import { GitHubAccount } from './GitHubAccount';
import { GitHubComment } from './GitHubComment';
import type { GitHubCommentControls } from './useGitHubComments';
import type { GitHubUser } from '@/lib/githubTypes';

/** GitHub supports whole-file comments on pull requests, without a review action. */
export function FileComments({
  path,
  comments,
  user,
}: {
  path: string;
  comments: GitHubCommentControls;
  user: GitHubUser | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const fileComments = comments.comments.filter(
    (comment) => comment.path === path && comment.anchor.kind === 'file'
  );
  return (
    <div onClick={(event) => event.stopPropagation()}>
      <Button
        variant="muted"
        size="sm"
        onClick={() => dialogRef.current?.showModal()}
        aria-label={`File comments for ${path}`}
      >
        File comments
        {fileComments.length > 0 ? ` (${fileComments.length})` : ''}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onCancel={(event) => {
          if (editing) event.preventDefault();
        }}
        className="border-border bg-background text-foreground fixed inset-0 m-auto max-h-[80dvh] w-[min(40rem,calc(100vw-2rem))] overflow-auto rounded-lg border p-4 shadow-lg backdrop:bg-black/40"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="min-w-0 text-base font-medium break-all">
            {path}
          </h2>
          <Button
            variant="muted"
            size="sm"
            onClick={() => {
              if (editing && !window.confirm('Discard this comment?')) return;
              setEditing(false);
              dialogRef.current?.close();
            }}
          >
            Close
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {fileComments.map((comment) => (
            <GitHubComment
              key={comment.id}
              comment={comment}
              userId={user?.id}
              onDelete={comments.remove}
            />
          ))}
          {comments.error != null && (
            <p role="alert" className="text-destructive text-sm">
              {comments.error}
            </p>
          )}
          {user == null ? (
            <GitHubAccount />
          ) : !comments.ready ? (
            <p className="text-sm">
              {comments.error == null
                ? 'Loading GitHub comments…'
                : 'Reload the diff to try again.'}
            </p>
          ) : editing ? (
            <CommentForm
              user={user}
              onCancel={() => setEditing(false)}
              onSave={(body) => comments.create(path, { kind: 'file' }, body)}
            />
          ) : (
            <Button onClick={() => setEditing(true)}>
              Comment on this file
            </Button>
          )}
        </div>
      </dialog>
    </div>
  );
}
