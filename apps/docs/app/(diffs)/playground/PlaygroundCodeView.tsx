'use client';

import {
  type CodeViewCreateEditorOptions,
  type CodeViewItem,
  type CodeViewOptions,
  type FileContents,
  parseDiffFromFile,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { CodeView, useStableCallback } from '@pierre/diffs/react';
import { useCallback, useState } from 'react';

const CODE_VIEW_STYLES = { height: '70vh', overflow: 'auto' } as const;

interface PlaygroundCodeViewProps {
  items: CodeViewItem[];
  options: CodeViewOptions<undefined>;
}

// Renders a mix of diff and file items in a CodeView. Unlike the Virtualizer
// mode, CodeView manages its own scroll container, so we give it a fixed height
// and `overflow: auto`.
//
// This view also demos first-class item editing: each header carries an Edit
// checkbox that flips the item's `edit` flag (any number of items can be in
// edit mode at once). CodeView creates one Editor per edited item through
// `createEditor` and keeps it attached across virtualization scroll-out, so
// unsaved edits and undo history survive scrolling. When a session ends
// (checkbox off), `onItemEditComplete` hands us the final contents and we
// persist them back into the item — file items swap contents directly, diff
// items re-diff the edited new side against the original old side.
export function PlaygroundCodeView({
  items: initialItems,
  options,
}: PlaygroundCodeViewProps) {
  const [items, setItems] = useState(initialItems);

  const toggleEdit = useCallback((id: string, edit: boolean) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, edit, version: (item.version ?? 0) + 1 }
          : item
      )
    );
  }, []);

  // Committing a finished edit session is user-space: CodeView only ends the
  // session and reports the final contents through this lifecycle. The app
  // commits with one combined item write — the new file/fileDiff (fresh
  // cacheKey, since the contents changed) along with `edit: false`.
  const handleEditComplete = useCallback(
    (item: CodeViewItem, file: FileContents) => {
      setItems((current) =>
        current.map((existing) => {
          if (existing.id !== item.id) {
            return existing;
          }
          const version = (existing.version ?? 0) + 1;
          const cacheKey = `${existing.id}:v${version}`;
          if (existing.type === 'file') {
            return {
              ...existing,
              file: { ...existing.file, contents: file.contents, cacheKey },
              edit: false,
              version,
            };
          }
          // Rebuild the diff against the edited new side. Generated diffs
          // carry the full old file in `deletionLines` (lines keep their
          // endings), so the original old side is recoverable from the item.
          const { fileDiff } = existing;
          return {
            ...existing,
            fileDiff: {
              ...parseDiffFromFile(
                {
                  name: fileDiff.prevName ?? fileDiff.name,
                  contents: fileDiff.deletionLines.join(''),
                },
                { name: fileDiff.name, contents: file.contents }
              ),
              cacheKey,
            },
            edit: false,
            version,
          };
        })
      );
    },
    []
  );

  const renderHeaderMetadata = useStableCallback(
    (item: CodeViewItem<undefined>) => {
      return (
        <label className="flex cursor-pointer items-center gap-[4px] text-xs select-none">
          <input
            type="checkbox"
            className="cursor-pointer"
            checked={item.edit === true}
            onChange={(event) => toggleEdit(item.id, event.target.checked)}
          />
          Edit
        </label>
      );
    }
  );

  return (
    <CodeView
      items={items}
      className="border-border rounded-lg border"
      style={CODE_VIEW_STYLES}
      options={options}
      createEditor={createEditor}
      onItemEditComplete={handleEditComplete}
      renderHeaderMetadata={renderHeaderMetadata}
    />
  );
}

function createEditor(editorOptions: CodeViewCreateEditorOptions<undefined>) {
  return new Editor(editorOptions);
}
