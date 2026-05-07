import type { DiffLineAnnotation } from '@pierre/diffs';
import { IconArrowRight } from '@pierre/icons';
import { useEffect, useRef, useState } from 'react';

import {
  annotationCardBase,
  type AvatarName,
  CommentAuthorAvatar,
  getRandomPersona,
} from './annotation-shared';
import type { DraftCommentMetadata } from './types';
import { Button } from '@/components/ui/button';

interface DraftAnnotationProps {
  annotation: DiffLineAnnotation<DraftCommentMetadata>;
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
  itemId,
  onCancel,
  onSave,
}: DraftAnnotationProps) {
  const [message, setMessage] = useState(annotation.metadata.message);
  const [persona] = useState(getRandomPersona);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmedMessage = message.trim();

  function handleSave() {
    if (trimmedMessage.length === 0) {
      return;
    }
    onSave(itemId, annotation.metadata.key, trimmedMessage, persona.name);
  }

  function tryCancel() {
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
      className={annotationCardBase}
      onSubmit={(event) => {
        event.preventDefault();
        handleSave();
      }}
    >
      <CommentAuthorAvatar seed={persona.name} />
      <textarea
        ref={textareaRef}
        value={message}
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
        placeholder="Add a comment…"
        rows={2}
        className="field-sizing-content w-full resize-none rounded-sm py-1.5 text-[14px] focus:outline-none"
      />
      <div className="flex justify-between gap-3">
        {/* <Button
          type="button"
          variant="link"
          onClick={tryCancel}
          className="text-muted-foreground hover:text-foreground gap-1 p-0 font-normal hover:no-underline"
        >
          <kbd className="rounded-sm bg-neutral-100 px-1.5 py-0.5 text-xs">
            Esc
          </kbd>
          to cancel
        </Button> */}
        <Button
          type="submit"
          variant="default"
          size="icon-md"
          disabled={trimmedMessage.length === 0}
          className="rounded-full bg-blue-500 hover:bg-blue-600"
        >
          {/* Save comment */}
          <IconArrowRight className="size-4 rotate-[-90deg]" />
        </Button>
      </div>
    </form>
  );
}
