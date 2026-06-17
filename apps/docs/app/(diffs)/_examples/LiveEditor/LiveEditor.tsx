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

interface LiveEditorProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
  prerenderedFile: PreloadedFileResult<undefined>;
}

type EditorMode = 'file' | 'diff';

export function LiveEditor({
  prerenderedDiff,
  prerenderedFile,
}: LiveEditorProps) {
  const [hasEdits, setHasEdits] = useState(false);
  // Default to the File surface: it edits through the editor's simple mode,
  // which has a clean 1:1 line model and avoids the diff-mode rendering
  // glitches. Users can opt into the FileDiff surface via the toggle.
  const [mode, setMode] = useState<EditorMode>('file');
  // Bumping this value remounts the editable surface, which is how Reset works
  // (see `handleReset`).
  const [resetKey, setResetKey] = useState(0);
  // Edits emit through the editor's debounced `onChange`. After a reset we
  // remount the surface, but a change scheduled just before the click can still
  // fire ~500ms later carrying the pre-reset (edited) contents, which would
  // flip `hasEdits` back on. We drop any `onChange` inside a short window after
  // a reset so a late straggler can't re-enable the button.
  const ignoreChangesUntilRef = useRef(0);

  const editor = useMemo(
    () =>
      new Editor({
        enabledSelectionAction: true,
        renderSelectionAction({
          close,
          replaceSelectionText,
          getSelectionText,
        }) {
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
        // boolean. The editable surface of a diff is its new-file side, so we
        // compare against that.
        onChange(file) {
          if (Date.now() < ignoreChangesUntilRef.current) {
            return;
          }
          setHasEdits(file.contents !== LIVE_EDITOR_NEW_FILE.contents);
        },
      }),
    [mode]
  );

  // Reset by remounting the editable surface. Bumping `resetKey` unmounts the
  // current File/FileDiff — whose teardown runs the editor's detach
  // (`editor.cleanUp()`), dropping the edited TextDocument and undo history —
  // and mounts a fresh one that re-hydrates the original prerendered HTML and
  // re-attaches the editor with a clean document. This reverts instantly in
  // both modes, and editing keeps working afterward because the editor rebuilds
  // from the now-original surface. The shared highlighter is module-global and
  // survives the remount, so syntax colors are preserved.
  const handleReset = useCallback(() => {
    setResetKey((key) => key + 1);
    setHasEdits(false);
    ignoreChangesUntilRef.current = Date.now() + 600;
  }, []);

  // The Reset button lives in the surface header for both File and FileDiff
  // views, so it's defined once and reused by each `renderHeaderMetadata`.
  const renderResetButton = useCallback(
    () => (
      <button
        onClick={handleReset}
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
            <Link href="/docs#editor-selection-action" className="inline-link">
              Selection Action
            </Link>{' '}
            widget.
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

      <div>
        <EditorProvider editor={editor}>
          {mode === 'diff' ? (
            <MultiFileDiff
              key={resetKey}
              {...prerenderedDiff}
              className="diff-container"
              renderHeaderMetadata={renderResetButton}
              contentEditable
            />
          ) : (
            <File
              key={resetKey}
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
