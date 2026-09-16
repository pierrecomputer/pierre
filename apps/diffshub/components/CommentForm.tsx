import { useCallback, useId, useRef, useState } from 'react';

import { CommentAuthorAvatar } from './CommentAuthorAvatar';
import { Button } from '@/components/Button';
import { annotationCardBase } from '@/lib/annotation';
import { cn } from '@/lib/cn';
import type { GitHubUser } from '@/lib/githubTypes';

interface CommentFormProps {
  user: GitHubUser;
  initialMessage?: string;
  disabled?: boolean;
  onCancel(): void;
  onSave(message: string): Promise<string | undefined>;
}

/** Keeps the draft until GitHub confirms the comment was published. */
export function CommentForm({
  user,
  initialMessage = '',
  disabled = false,
  onCancel,
  onSave,
}: CommentFormProps) {
  const [message, setMessage] = useState(initialMessage);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const errorId = useId();
  const trimmedMessage = message.trim();
  const focusTextarea = useCallback((node: HTMLTextAreaElement | null) => {
    node?.focus({ preventScroll: true });
  }, []);

  async function handleSave() {
    if (disabled || pending.current || trimmedMessage.length === 0) return;
    pending.current = true;
    setSending(true);
    setError(undefined);
    try {
      const failure = await onSave(trimmedMessage);
      if (failure != null) setError(failure);
      else onCancel();
    } finally {
      pending.current = false;
      setSending(false);
    }
  }

  function tryCancel() {
    if (
      sending ||
      (trimmedMessage.length > 0 && !window.confirm('Discard this comment?'))
    )
      return;
    onCancel();
  }

  return (
    <form
      className={cn(annotationCardBase, 'flex-col')}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <div className="flex w-full gap-2.5">
        <CommentAuthorAvatar name={user.login} src={user.avatarUrl} />
        <textarea
          ref={focusTextarea}
          aria-label="Code comment"
          aria-describedby={error == null ? undefined : errorId}
          aria-invalid={error != null}
          disabled={sending}
          value={message}
          onChange={({ currentTarget }) => setMessage(currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              tryCancel();
            } else if (
              (event.metaKey || event.ctrlKey) &&
              event.key === 'Enter'
            ) {
              event.preventDefault();
              void handleSave();
            }
          }}
          placeholder="Add a code comment…"
          rows={2}
          maxLength={65536}
          className="focus-visible:outline-ring field-sizing-content w-full resize-none rounded-sm bg-transparent py-1.5 text-[14px] text-inherit placeholder:text-[var(--diffshub-popover-muted-fg,var(--color-muted-foreground))] focus-visible:outline-2"
        />
      </div>
      {error != null && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex w-full items-center justify-end gap-2">
        <Button
          type="button"
          variant="muted"
          onClick={tryCancel}
          disabled={sending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={disabled || sending || trimmedMessage.length === 0}
        >
          {sending ? 'Posting…' : 'Post to GitHub'}
        </Button>
      </div>
    </form>
  );
}
