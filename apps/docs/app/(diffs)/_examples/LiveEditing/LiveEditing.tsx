'use client';

import { cloneFileDiffMetadata } from '@pierre/diffs';
import type { EditorChangeEvent } from '@pierre/diffs/edit';
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

import { LIVE_EDITING_NEW_FILE } from './constants';
import { FeatureHeader } from '@/components/FeatureHeader';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface LiveEditingProps {
  // Pre-rendered File component (the additions-only view) and FileDiff component
  // (before/after). We ship both so toggling between them hydrates from
  // server HTML instead of flashing in after client highlighting.
  prerenderedFile: PreloadedFileResult<undefined, undefined>;
  prerenderedDiff: PreloadFileDiffResult<undefined, undefined>;
}

type LiveEditingChangeEvent =
  | EditorChangeEvent<'file', undefined, undefined>
  | EditorChangeEvent<'file-diff', undefined, undefined>;

// Which component the demo renders: a standalone File or a before/after FileDiff.
type DemoView = 'file' | 'diff';

// Review renders the component read-only (how diffs renders by default); Edit
// attaches the editor and makes it editable in place.
type EditMode = 'review' | 'edit';

// Layout the diff renders in. Only applies to the FileDiff component.
type DiffLayout = 'unified' | 'split';

export function LiveEditing({
  prerenderedFile,
  prerenderedDiff,
}: LiveEditingProps) {
  const [hasEdits, setHasEdits] = useState(false);
  const [view, setView] = useState<DemoView>('file');
  // Default to Edit so the editor is live on first paint; the toggle drops back
  // to a read-only Review of the same component.
  const [mode, setMode] = useState<EditMode>('edit');
  // Default to the layout the diff was prerendered in (unified) so the first
  // paint hydrates without a flash; toggling re-renders the component client-side.
  const [diffLayout, setDiffLayout] = useState<DiffLayout>(
    prerenderedDiff.options?.diffStyle === 'split' ? 'split' : 'unified'
  );
  // Bumping this value remounts the editable component from pristine input.
  // Reset and view changes use it as a deliberate new-session boundary.
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

  // Both components synchronously report the current new-file contents.
  const handleEditChange = useCallback((event: LiveEditingChangeEvent) => {
    setHasEdits(event.file.contents !== LIVE_EDITING_NEW_FILE.contents);
  }, []);

  // Reset and component switches deliberately discard the current edit session.
  // The new key also rebuilds mutable FileDiff metadata from its pristine copy.
  const resetEditableComponent = useCallback(() => {
    setHasEdits(false);
    setResetKey((key) => key + 1);
  }, []);

  const handleViewChange = useCallback(
    (value: DemoView) => {
      setView(value);
      resetEditableComponent();
    },
    [resetEditableComponent]
  );

  // Layout is only a view option, so changing it keeps the current edit session.
  const handleDiffLayoutChange = useCallback((value: DiffLayout) => {
    setDiffLayout(value);
  }, []);

  // The Reset button lives in the component header for both File and FileDiff
  // views, so it's defined once and reused by each `renderHeaderMetadata`.
  const renderResetButton = useCallback(
    () => (
      <button
        onClick={resetEditableComponent}
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
    [hasEdits, resetEditableComponent]
  );

  const headerMetadata = mode === 'edit' ? renderResetButton : undefined;
  const edit = mode === 'edit';

  return (
    <div className="space-y-5">
      <FeatureHeader
        id="edit"
        title="Live editing"
        description={
          <>
            Edit mode (experimental) makes any code component—<code>File</code>{' '}
            or <code>FileDiff</code>—editable in place. Toggle between a
            read-only <strong>Review</strong> and a live <strong>Edit</strong>,
            switch the component between a file and a diff, and render the diff
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
          value={view}
          onValueChange={(value) => handleViewChange(value as DemoView)}
          aria-label="View"
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
              // Layout only applies to the diff component; disable it for files.
              disabled={view === 'file'}
            >
              {value === 'split' ? <IconDiffSplit /> : <IconDiffUnified />}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </div>

      <div>
        {view === 'file' ? (
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
            onEditChange={handleEditChange}
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
            onEditChange={handleEditChange}
          />
        )}
      </div>
    </div>
  );
}
