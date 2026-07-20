'use client';

import { cloneFileDiffMetadata } from '@pierre/diffs';
import type { EditorOptions } from '@pierre/diffs/editor';
import { File, FileDiff } from '@pierre/diffs/react';
import type {
  PreloadedFileResult,
  PreloadFileDiffResult,
} from '@pierre/diffs/ssr';
import {
  IconDiffSplit,
  IconDiffUnified,
  IconPencil,
  IconRefresh,
} from '@pierre/icons';
import { useCallback, useMemo, useState } from 'react';

import { LIVE_EDITOR_NEW_FILE } from '../LiveEditor/constants';
import { FeatureHeader } from '@/components/FeatureHeader';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface LiveEditingProps {
  // Pre-rendered File surface (the additions-only view) and the FileDiff
  // surface (before/after). We ship both so toggling between them hydrates from
  // server HTML instead of flashing in after client highlighting.
  prerenderedFile: PreloadedFileResult<undefined>;
  prerenderedDiff: PreloadFileDiffResult<undefined>;
}

// Which surface the demo renders: a standalone File or a before/after FileDiff.
type Surface = 'file' | 'diff';

// Review renders the surface read-only (how diffs renders by default); Edit
// attaches the editor and makes it editable in place.
type EditorMode = 'review' | 'edit';

// Layout the diff renders in. Only applies to the FileDiff surface.
type DiffLayout = 'unified' | 'split';

export function LiveEditing({
  prerenderedFile,
  prerenderedDiff,
}: LiveEditingProps) {
  const [hasEdits, setHasEdits] = useState(false);
  const [surface, setSurface] = useState<Surface>('file');
  // Default to Edit so the editor is live on first paint; the toggle drops back
  // to a read-only Review of the same surface.
  const [mode, setMode] = useState<EditorMode>('edit');
  // Default to the layout the diff was prerendered in (unified) so the first
  // paint hydrates without a flash; toggling re-renders the surface client-side.
  const [diffLayout, setDiffLayout] = useState<DiffLayout>(
    prerenderedDiff.options?.diffStyle === 'split' ? 'split' : 'unified'
  );
  // Bumping this value remounts the editable surface from pristine input.
  // Reset and surface changes use it as a deliberate new-session boundary.
  const [resetKey, setResetKey] = useState(0);
  // Editing a FileDiff updates the diff metadata it renders from so the live
  // hunks stay in sync. Keep an untouched baseline and hand FileDiff a fresh
  // clone for each remount; Reset must rebuild from the original additions, not
  // a previously edited object.
  const pristineFileDiff = useMemo(
    () => cloneFileDiffMetadata(prerenderedDiff.fileDiff),
    [prerenderedDiff.fileDiff]
  );
  const liveFileDiff = useMemo(
    () => ({
      ...cloneFileDiffMetadata(pristineFileDiff),
      cacheKey: pristineFileDiff.name + resetKey,
    }),
    [pristineFileDiff, resetKey]
  );

  const editOptions = useMemo<EditorOptions<undefined>>(
    () => ({
      // Both surfaces synchronously report the current new-file contents.
      onChange(file) {
        setHasEdits(file.contents !== LIVE_EDITOR_NEW_FILE.contents);
      },
    }),
    []
  );

  // Reset and surface switches deliberately discard the current edit session.
  // The new key also rebuilds mutable FileDiff metadata from its pristine copy.
  const resetEditableSurface = useCallback(() => {
    setHasEdits(false);
    setResetKey((key) => key + 1);
  }, []);

  const handleSurfaceChange = useCallback(
    (value: Surface) => {
      setSurface(value);
      resetEditableSurface();
    },
    [resetEditableSurface]
  );

  // Layout is only a view option, so changing it keeps the current edit session.
  const handleDiffLayoutChange = useCallback((value: DiffLayout) => {
    setDiffLayout(value);
  }, []);

  // The Reset button lives in the surface header for both File and FileDiff
  // views, so it's defined once and reused by each `renderHeaderMetadata`.
  const renderResetButton = useCallback(
    () => (
      <button
        onClick={resetEditableSurface}
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
    [hasEdits, resetEditableSurface]
  );

  const headerMetadata = mode === 'edit' ? renderResetButton : undefined;
  const edit = mode === 'edit';

  return (
    <div className="space-y-5">
      <FeatureHeader
        id="editor"
        title="Live editing"
        description={
          <>
            Editor mode (experimental) makes any code surface—<code>File</code>{' '}
            or <code>FileDiff</code>—editable in place. Toggle between a
            read-only <strong>Review</strong> and a live <strong>Edit</strong>,
            switch the surface between a file and a diff, and render the diff
            unified or side-by-side split. Start typing in the code below and it
            updates as you edit.
          </>
        }
      />

      <div className="flex flex-wrap gap-3">
        <div className="gridstack">
          <Button
            variant="outline"
            className="justify-between gap-3 pr-11 pl-3"
            onClick={() => setMode(mode === 'edit' ? 'review' : 'edit')}
          >
            <div className="flex items-center gap-2">
              <IconPencil className="-ml-0.5" />
              Edit mode
            </div>
          </Button>
          {/* Visual-only indicator stacked over the button; the Button is the
              interactive control, so keep the switch out of the tab order and
              hidden from assistive tech to avoid a duplicate toggle. */}
          <Switch
            checked={mode === 'edit'}
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none mr-3 place-self-center justify-self-end"
          />
        </div>

        <ButtonGroup
          value={surface}
          onValueChange={(value) => handleSurfaceChange(value as Surface)}
          aria-label="Surface"
        >
          {(['file', 'diff'] as const).map((value) => (
            <ButtonGroupItem key={value} value={value} className="capitalize">
              {value}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>

        <ButtonGroup
          value={diffLayout}
          onValueChange={(value) => handleDiffLayoutChange(value as DiffLayout)}
          aria-label="Diff layout"
          size="icon"
        >
          {(['unified', 'split'] as const).map((value) => (
            <ButtonGroupItem
              key={value}
              value={value}
              aria-label={value}
              // Layout only applies to the diff surface; disable it for files.
              disabled={surface === 'file'}
            >
              {value === 'split' ? <IconDiffSplit /> : <IconDiffUnified />}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </div>

      <div>
        {surface === 'file' ? (
          <File
            key={resetKey}
            {...prerenderedFile}
            file={{
              ...prerenderedFile.file,
              cacheKey: prerenderedFile.file.name + resetKey,
            }}
            className="diff-container"
            renderHeaderMetadata={headerMetadata}
            edit={edit}
            editOptions={editOptions}
          />
        ) : (
          <FileDiff
            key={resetKey}
            {...prerenderedDiff}
            fileDiff={liveFileDiff}
            options={{ ...prerenderedDiff.options, diffStyle: diffLayout }}
            className="diff-container"
            renderHeaderMetadata={headerMetadata}
            edit={edit}
            editOptions={editOptions}
          />
        )}
      </div>
    </div>
  );
}
