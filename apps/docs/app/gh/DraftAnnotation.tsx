import type { DiffLineAnnotation } from '@pierre/diffs';
import { useEffect, useRef, useState } from 'react';

import type { DraftCommentMetadata } from './types';
import { Button } from '@/components/ui/button';

interface DraftAnnotationProps {
  annotation: DiffLineAnnotation<DraftCommentMetadata>;
  itemId: string;
  onCancel(itemId: string, key: string): void;
  onSave(itemId: string, key: string, message: string): void;
}

export function DraftAnnotation({
  annotation,
  itemId,
  onCancel,
  onSave,
}: DraftAnnotationProps) {
  const [message, setMessage] = useState(annotation.metadata.message);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmedMessage = message.trim();

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
      className="m-2 max-w-[600px] rounded-md border border-[var(--color-border)] bg-[var(--diffs-bg)] p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmedMessage.length === 0) {
          return;
        }
        onSave(itemId, annotation.metadata.key, trimmedMessage);
      }}
    >
      <textarea
        ref={textareaRef}
        value={message}
        onChange={({ currentTarget }) => setMessage(currentTarget.value)}
        onKeyDown={(event) => {
          if (!event.shiftKey || event.key !== 'Enter') {
            return;
          }

          event.preventDefault();
          if (trimmedMessage.length === 0) {
            return;
          }

          onSave(itemId, annotation.metadata.key, trimmedMessage);
        }}
        placeholder="Add a comment"
        rows={2}
        className="mb-2 w-full resize-y rounded-sm border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-[13px]"
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onCancel(itemId, annotation.metadata.key)}
        >
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={trimmedMessage.length === 0}>
          Save comment
        </Button>
      </div>
    </form>
  );
}
