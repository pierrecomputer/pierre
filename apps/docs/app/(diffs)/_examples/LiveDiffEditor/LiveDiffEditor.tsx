'use client';

import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, FileDiff } from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import { IconRefresh } from '@pierre/icons';
import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';

import { LIVE_EDITOR_NEW_FILE } from '../LiveEditor/constants';
import { FeatureHeader } from '@/components/FeatureHeader';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { cn } from '@/lib/utils';

interface LiveDiffEditorProps {
  prerenderedDiff: PreloadFileDiffResult<undefined>;
}

// Review renders the FileDiff read-only (how diffs renders by default); Edit
// attaches the editor and makes the additions side editable in place. This is
// the diff counterpart to the LiveEditor (File) demo, isolating diff editing on
// a single FileDiff instance.
type EditorMode = 'review' | 'edit';

// Layout the diff renders in. The toggle lets us verify editing works in both
// the side-by-side (split) and inline (unified) layouts.
type DiffLayout = 'split' | 'unified';

export function LiveDiffEditor({ prerenderedDiff }: LiveDiffEditorProps) {
  const [hasEdits, setHasEdits] = useState(false);
  // Default to Edit so the editor is live on first paint; the toggle drops back
  // to a read-only Review of the same surface.
  const [mode, setMode] = useState<EditorMode>('edit');
  // Default to the layout the diff was prerendered in (unified) so the first
  // paint hydrates without a flash; toggling re-renders the surface client-side.
  const [diffLayout, setDiffLayout] = useState<DiffLayout>(
    prerenderedDiff.options?.diffStyle === 'split' ? 'split' : 'unified'
  );
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
        // boolean. The editable surface of a diff is its new-file (additions)
        // side, so we compare against that.
        onChange(file) {
          if (Date.now() < ignoreChangesUntilRef.current) {
            return;
          }
          setHasEdits(file.contents !== LIVE_EDITOR_NEW_FILE.contents);
        },
      }),
    // Recreate the editor when either the review/edit mode or the diff layout
    // changes so it re-attaches to the freshly relaid-out surface instead of
    // reusing a stale instance (same reasoning as the LiveEditor `mode` dep).
    [mode, diffLayout]
  );

  // Reset by remounting the editable surface. Bumping `resetKey` unmounts the
  // current FileDiff — whose teardown runs the editor's detach
  // (`editor.cleanUp()`), dropping the edited TextDocument and undo history —
  // and mounts a fresh one that re-hydrates the original prerendered HTML and
  // re-attaches the editor with a clean document.
  const handleReset = useCallback(() => {
    setResetKey((key) => key + 1);
    setHasEdits(false);
    ignoreChangesUntilRef.current = Date.now() + 600;
  }, []);

  // Switching layout recreates the editor (see the memo deps), which rebuilds
  // the surface from the original diff and drops in-progress edits, so clear the
  // edited state and ignore the late `onChange` straggler the same way Reset
  // does.
  const handleDiffLayoutChange = useCallback((value: DiffLayout) => {
    setDiffLayout(value);
    setHasEdits(false);
    ignoreChangesUntilRef.current = Date.now() + 600;
  }, []);

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
        id="diff-editor"
        title="Live diff editing"
        description={
          <>
            Editor mode also works on a <code>FileDiff</code>. Switch from{' '}
            <strong>Review</strong> (read-only) to <strong>Edit</strong>, then
            edit the additions side of the diff below in place. Deletion lines
            stay read-only. Select text to try the custom{' '}
            <Link href="/docs#editor-selection-action" className="inline-link">
              Selection Action
            </Link>{' '}
            widget.
          </>
        }
      />

      <div className="flex flex-wrap gap-3">
        <ButtonGroup
          value={mode}
          onValueChange={(value) => setMode(value as EditorMode)}
          aria-label="Editor mode"
        >
          {(['review', 'edit'] as const).map((value) => (
            <ButtonGroupItem key={value} value={value} className="capitalize">
              {value}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>

        <ButtonGroup
          value={diffLayout}
          onValueChange={(value) => handleDiffLayoutChange(value as DiffLayout)}
          aria-label="Diff layout"
        >
          {(['unified', 'split'] as const).map((value) => (
            <ButtonGroupItem key={value} value={value} className="capitalize">
              {value}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </div>

      <div>
        <EditorProvider editor={editor}>
          <FileDiff
            key={resetKey}
            {...prerenderedDiff}
            options={{ ...prerenderedDiff.options, diffStyle: diffLayout }}
            className="diff-container"
            renderHeaderMetadata={
              mode === 'edit' ? renderResetButton : undefined
            }
            contentEditable={mode === 'edit'}
          />
        </EditorProvider>
      </div>
    </div>
  );
}
