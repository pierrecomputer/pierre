'use client';

import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, File, MultiFileDiff } from '@pierre/diffs/react';
import type {
  PreloadedFileResult,
  PreloadMultiFileDiffResult,
} from '@pierre/diffs/ssr';
import { IconRefresh } from '@pierre/icons';
import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';

import { LIVE_EDITOR_NEW_FILE } from './constants';
import { FeatureHeader } from '@/components/FeatureHeader';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { cn } from '@/lib/utils';

// Largest number of undo steps we will replay on reset. The editor keeps a
// bounded history (100 entries), so anything past that can't be reverted
// anyway; extra dispatches are harmless no-ops once the undo stack is empty.
const MAX_UNDO_STEPS = 200;

// Find the editor's contentEditable surface inside the rendered File. The File
// renders into a `diffs-container` custom element with a shadow root; the editor
// attaches its contentEditable to the (non-deletion) code content element there.
function findEditorContentElement(
  wrapper: HTMLElement | null
): HTMLElement | null {
  const host = wrapper?.querySelector('diffs-container');
  return (
    host?.shadowRoot?.querySelector<HTMLElement>('[contenteditable="true"]') ??
    null
  );
}

interface LiveEditorProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
  prerenderedFile: PreloadedFileResult<undefined>;
}

type EditorMode = 'file' | 'diff';

export function LiveEditor({
  prerenderedDiff,
  prerenderedFile,
}: LiveEditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hasEdits, setHasEdits] = useState(false);
  // Default to the File surface: it edits through the editor's simple mode,
  // which has a clean 1:1 line model and avoids the diff-mode rendering
  // glitches. Users can opt into the FileDiff surface via the toggle.
  const [mode, setMode] = useState<EditorMode>('file');

  const editor = useMemo(
    () =>
      new Editor({
        enabledQuickEdit: true,
        renderQuickEdit({ close, replaceSelectionText, getSelectionText }) {
          const container = document.createElement('div');
          const button = document.createElement('button');

          container.style.cssText =
            'display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 0;';
          button.type = 'button';
          button.textContent = 'Wrap selection in TODO()';
          button.style.cssText =
            'font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); background: color-mix(in srgb, currentColor 8%, transparent); cursor: pointer;';
          button.addEventListener('click', () => {
            replaceSelectionText(`TODO(${getSelectionText()})`);
            close();
          });

          container.appendChild(button);
          return container;
        },
        // `onChange` is debounced internally, so we derive "edited" state by
        // comparing the live contents to the original rather than latching a
        // boolean. This is what lets Reset settle the button back to disabled:
        // after the undo replay restores the original text, the trailing
        // debounced change reports contents equal to the original again. The
        // editable surface of a diff is its new-file side, so we compare against
        // that.
        onChange(file) {
          setHasEdits(file.contents !== LIVE_EDITOR_NEW_FILE.contents);
        },
      }),
    []
  );

  // Reset by replaying the editor's own undo history rather than remounting.
  // We synthesize Cmd/Ctrl+Z keydown events on the content element; the editor's
  // existing handler runs each undo through the same re-tokenize pipeline as
  // typing, so syntax highlighting is preserved (a remount would tear down and
  // rebuild the shared highlighter, which dropped the colors). The editor
  // applies each undo asynchronously, so we wait a frame between steps and stop
  // once the text stops changing (undo stack exhausted).
  const handleReset = useCallback(async () => {
    const contentEl = findEditorContentElement(wrapperRef.current);
    if (contentEl == null) {
      return;
    }
    const isMac = /Mac|iP(?:hone|ad|od)/i.test(navigator.platform);
    const nextFrame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

    contentEl.focus();
    for (let step = 0; step < MAX_UNDO_STEPS; step++) {
      const before = contentEl.textContent;
      contentEl.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          metaKey: isMac,
          ctrlKey: !isMac,
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
      await nextFrame();
      // Once an undo no longer changes the text, the stack is exhausted.
      if (contentEl.textContent === before) {
        break;
      }
    }
    // Optimistically clear; the debounced onChange will confirm by comparing
    // the restored contents to the original.
    setHasEdits(false);
  }, []);

  // The Reset button lives in the surface header for both File and FileDiff
  // views, so it's defined once and reused by each `renderHeaderMetadata`.
  const renderResetButton = useCallback(
    () => (
      <button
        onClick={() => void handleReset()}
        disabled={!hasEdits}
        title="Revert to the original contents"
        className={cn(
          'mr-[-6px] ml-1.5 flex items-center gap-1 rounded-md px-2 py-0.5',
          hasEdits
            ? 'bg-accent/30 text-white'
            : 'text-muted-foreground/40 bg-accent/10'
        )}
      >
        <IconRefresh size={12} />
        Reset
      </button>
    ),
    [handleReset, hasEdits]
  );

  return (
    <div className="space-y-5">
      <FeatureHeader
        id="editor"
        isBeta={true}
        title="Live editing"
        description={
          <>
            Editor mode (experimental) makes any code surface—<code>File</code>{' '}
            or <code>FileDiff</code>—editable in place. Start typing in the code
            below and it updates as you edit. Select text to try the custom{' '}
            <Link href="/docs#editor-quick-edit" className="inline-link">
              Quick Edit
            </Link>{' '}
            action.
          </>
        }
      />

      <ButtonGroup
        value={mode}
        onValueChange={(value) => setMode(value as EditorMode)}
        aria-label="Editor surface"
      >
        {(['file', 'diff'] as const).map((value) => (
          <ButtonGroupItem key={value} value={value} className="capitalize">
            {value}
          </ButtonGroupItem>
        ))}
      </ButtonGroup>

      <div ref={wrapperRef}>
        <EditorProvider editor={editor}>
          {mode === 'diff' ? (
            <MultiFileDiff
              {...prerenderedDiff}
              className="diff-container"
              renderHeaderMetadata={renderResetButton}
              contentEditable
            />
          ) : (
            <File
              {...prerenderedFile}
              className="diff-container"
              renderHeaderMetadata={renderResetButton}
              contentEditable
            />
          )}
        </EditorProvider>
      </div>
    </div>
  );
}
