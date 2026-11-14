import type { DiffLineAnnotation } from '@pierre/diffs';
import { useEffect, useRef, useState } from 'react';

import { CommentAuthorAvatar } from './CommentAuthorAvatar';
import { Button } from '@/components/Button';
import {
  annotationCardBase,
  type AvatarName,
  getRandomPersona,
} from '@/lib/annotation';
import { cn } from '@/lib/cn';
import type { GitHubCommentUser } from '@/lib/githubComments';
import type { DraftCommentMetadata } from '@/lib/types';

interface DraftAnnotationProps {
  annotation: DiffLineAnnotation<DraftCommentMetadata>;
  githubAuthor?: GitHubCommentUser;
  hint?: string;
  itemId: string;
  onCancel(itemId: string, key: string): void;
  onSave(
    itemId: string,
    key: string,
    message: string,
    author: AvatarName
  ): void;
}

export function DraftAnnotation({
  annotation,
  githubAuthor,
  hint,
  itemId,
  onCancel,
  onSave,
}: DraftAnnotationProps) {
  const [message, setMessage] = useState(annotation.metadata.message);
  const [persona] = useState(getRandomPersona);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmedMessage = message.trim();
  const pending = annotation.metadata.pending === true;

  function handleSave() {
    if (trimmedMessage.length === 0 || pending) {
      return;
    }
    onSave(itemId, annotation.metadata.key, trimmedMessage, persona.name);
  }

  function tryCancel() {
    if (pending) {
      return;
    }
    if (trimmedMessage.length > 0 && !window.confirm('Discard this comment?')) {
      return;
    }
    onCancel(itemId, annotation.metadata.key);
  }

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea == null) {
      return;
    }

    textarea.focus({ preventScroll: true });
    const cursorIndex = textarea.value.length;
    textarea.setSelectionRange(cursorIndex, cursorIndex);
  }, []);

  return (
    <form
      className={cn(annotationCardBase, 'flex-col gap-2')}
      onSubmit={(event) => {
        event.preventDefault();
        handleSave();
      }}
    >
      <div className="flex w-full gap-2.5">
        <CommentAuthorAvatar
          seed={githubAuthor?.login ?? persona.name}
          avatarUrl={githubAuthor?.avatarUrl}
        />
        <textarea
          ref={textareaRef}
          value={message}
          disabled={pending}
          onChange={({ currentTarget }) => setMessage(currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              tryCancel();
              return;
            }

            if ((!event.shiftKey && !event.metaKey) || event.key !== 'Enter') {
              return;
            }

            event.preventDefault();
            handleSave();
          }}
          placeholder="Leave a comment"
          rows={2}
          className="field-sizing-content min-h-16 w-full resize-none rounded-lg border border-[var(--diffshub-annotation-border,var(--color-border))] bg-transparent px-3 py-2 text-[14px] text-inherit placeholder:text-[var(--diffshub-popover-muted-fg,var(--color-muted-foreground))] focus:border-blue-500 focus:outline-none disabled:opacity-60"
        />
      </div>
      <div className="flex w-full items-center justify-between gap-3 pl-10.5">
        <p className="text-muted-foreground min-w-0 text-[12px]">{hint}</p>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="muted"
            size="sm"
            disabled={pending}
            onClick={tryCancel}
            className="text-muted-foreground hover:text-foreground font-normal hover:no-underline"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="default"
            size="sm"
            disabled={trimmedMessage.length === 0 || pending}
            className="bg-blue-500 hover:bg-blue-600"
          >
            {pending ? 'Posting…' : githubAuthor != null ? 'Comment' : 'Submit'}
          </Button>
        </div>
      </div>
    </form>
  );
}
