'use client';

import { cloneFileDiffMetadata } from '@pierre/diffs';
import type {
  Editor,
  EditorOptions,
  EditPredictProvider,
  EditPredictResponse,
} from '@pierre/diffs/edit';
import { File, FileDiff } from '@pierre/diffs/react';
import type {
  PreloadedFileResult,
  PreloadFileDiffResult,
} from '@pierre/diffs/ssr';
import { IconCursor, IconRefresh } from '@pierre/icons';
import { useCallback, useMemo, useRef, useState } from 'react';

import { EDIT_PREDICTION_NEW_FILE } from './constants';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

interface EditPredictionDemoProps {
  prerenderedFile: PreloadedFileResult<undefined>;
  prerenderedDiff: PreloadFileDiffResult<undefined>;
}

type Surface = 'file' | 'diff';
type PredictionMode = 'eager' | 'subtle';
type PredictionStatus =
  | 'idle'
  | 'waiting'
  | 'predicting'
  | 'ready'
  | 'empty'
  | 'error';

const INCLUDE = ['**/*.ts'] as const;
const EXCLUDE = ['**/*.test.ts'] as const;
const CURSOR_ANCHOR = 'return items.';

export function EditPredictionDemo({
  prerenderedFile,
  prerenderedDiff,
}: EditPredictionDemoProps) {
  const editorRef = useRef<Editor<undefined> | null>(null);
  const predictionEnabledRef = useRef(false);
  const [attached, setAttached] = useState(false);
  const [hasEdits, setHasEdits] = useState(false);
  const [mode, setMode] = useState<PredictionMode>('eager');
  const [predictionEnabled, setPredictionEnabled] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [status, setStatus] = useState<PredictionStatus>('idle');
  const [surface, setSurface] = useState<Surface>('file');

  const provider = useMemo<EditPredictProvider>(
    () => ({
      async predict(request, { signal }) {
        if (!predictionEnabledRef.current) {
          const prefix = request.excerptText.slice(
            0,
            request.cursorOffsetInExcerpt
          );
          const lines = prefix.split(request.eol);
          return {
            edits: [],
            newCursor: {
              line: request.excerptStartLine + lines.length - 1,
              character: lines.at(-1)?.length ?? 0,
            },
          };
        }

        setStatus('predicting');
        try {
          const response = await fetch('/api/edit-prediction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal,
          });
          if (!response.ok) {
            throw new Error('Edit prediction request failed');
          }
          const prediction = (await response.json()) as EditPredictResponse;
          if (!signal.aborted) {
            setStatus(prediction.edits.length === 0 ? 'empty' : 'ready');
          }
          return prediction;
        } catch (error) {
          if (!signal.aborted) {
            setStatus('error');
          }
          throw error;
        }
      },
    }),
    []
  );

  const editPrediction = useMemo(
    () => ({ provider, mode, include: INCLUDE, exclude: EXCLUDE }),
    [mode, provider]
  );
  const editorOptions = useMemo<EditorOptions<undefined>>(
    () => ({
      editPrediction,
      onAttach(editor) {
        editorRef.current = editor;
        setAttached(true);
      },
      onChange(file) {
        setHasEdits(file.contents !== EDIT_PREDICTION_NEW_FILE.contents);
        if (predictionEnabledRef.current) {
          setStatus('waiting');
        }
      },
    }),
    [editPrediction]
  );

  const pristineFileDiff = useMemo(
    () => cloneFileDiffMetadata(prerenderedDiff.fileDiff),
    [prerenderedDiff.fileDiff]
  );
  const liveFileDiff = useMemo(
    () => ({
      ...cloneFileDiffMetadata(pristineFileDiff),
      cacheKey: `${pristineFileDiff.name}-${String(resetKey)}`,
    }),
    [pristineFileDiff, resetKey]
  );

  const reset = useCallback(() => {
    predictionEnabledRef.current = false;
    editorRef.current = null;
    setAttached(false);
    setHasEdits(false);
    setPredictionEnabled(false);
    setStatus('idle');
    setResetKey((key) => key + 1);
  }, []);

  const placeCursor = useCallback(() => {
    const editor = editorRef.current;
    if (editor == null) {
      return;
    }
    const lines = editor.getText().split(/\r\n|\r|\n/);
    const line = lines.findIndex((text) => text.includes(CURSOR_ANCHOR));
    if (line < 0) {
      return;
    }
    const character = lines[line].indexOf(CURSOR_ANCHOR) + CURSOR_ANCHOR.length;
    predictionEnabledRef.current = true;
    setPredictionEnabled(true);
    setStatus('waiting');
    editor.setOptions({ editPrediction: { ...editPrediction } });
    editor.setSelections([
      {
        start: { line, character },
        end: { line, character },
        direction: 'none',
      },
    ]);
    editor.focus({ preventScroll: true });
  }, [editPrediction]);

  const handleModeChange = useCallback(
    (value: PredictionMode) => {
      setMode(value);
      editorRef.current?.setOptions({
        editPrediction: { ...editPrediction, mode: value },
      });
      if (predictionEnabledRef.current) {
        setStatus('waiting');
      }
    },
    [editPrediction]
  );

  const handleSurfaceChange = useCallback(
    (value: Surface) => {
      setSurface(value);
      reset();
    },
    [reset]
  );

  const statusText = !predictionEnabled
    ? 'No API request sent. Try Codestral to begin.'
    : status === 'waiting'
      ? 'Waiting 300 ms before predicting…'
      : status === 'predicting'
        ? 'Predicting…'
        : status === 'ready'
          ? mode === 'subtle'
            ? 'Prediction ready — hold Alt and press Tab to accept.'
            : 'Prediction ready — press Tab to accept.'
          : status === 'empty'
            ? 'No suggestion returned. Keep editing to try again.'
            : status === 'error'
              ? 'Prediction unavailable. Check the demo service and try again.'
              : 'Try Codestral to begin.';

  return (
    <div className="not-prose">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ButtonGroup
          value={surface}
          onValueChange={(value) => handleSurfaceChange(value as Surface)}
          aria-label="Surface"
        >
          <ButtonGroupItem value="file">File</ButtonGroupItem>
          <ButtonGroupItem value="diff">FileDiff</ButtonGroupItem>
        </ButtonGroup>

        <ButtonGroup
          value={mode}
          onValueChange={(value) => handleModeChange(value as PredictionMode)}
          aria-label="Prediction mode"
        >
          <ButtonGroupItem value="eager">Eager</ButtonGroupItem>
          <ButtonGroupItem value="subtle">Subtle</ButtonGroupItem>
        </ButtonGroup>

        <Button variant="outline" onClick={placeCursor} disabled={!attached}>
          <IconCursor />
          Try Codestral
        </Button>
        <Button
          variant="outline"
          onClick={reset}
          disabled={!hasEdits && !predictionEnabled}
        >
          <IconRefresh />
          Reset
        </Button>

        <span
          className="text-muted-foreground basis-full text-xs md:ml-auto md:basis-auto"
          role="status"
          aria-live="polite"
        >
          {statusText}
        </span>
      </div>

      {surface === 'file' ? (
        <File
          key={resetKey}
          {...prerenderedFile}
          file={{
            ...prerenderedFile.file,
            cacheKey: `${prerenderedFile.file.name}-${String(resetKey)}`,
          }}
          className="diff-container"
          edit
          editorOptions={editorOptions}
        />
      ) : (
        <FileDiff
          key={resetKey}
          {...prerenderedDiff}
          fileDiff={liveFileDiff}
          className="diff-container"
          edit
          editorOptions={editorOptions}
        />
      )}
    </div>
  );
}
