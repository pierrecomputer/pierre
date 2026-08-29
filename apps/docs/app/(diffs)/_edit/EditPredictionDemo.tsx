'use client';

import { cloneFileDiffMetadata } from '@pierre/diffs';
import type {
  Editor,
  EditorOptions,
  EditorType,
  EditPredictProvider,
  EditPredictResponse,
} from '@pierre/diffs/edit';
import { File, FileDiff } from '@pierre/diffs/react';
import type {
  PreloadedFileResult,
  PreloadFileDiffResult,
} from '@pierre/diffs/ssr';
import { IconBrandGithub, IconRefresh } from '@pierre/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CodestralIcon } from './CodestralIcon';
import { EDIT_PREDICTION_NEW_FILE } from './constants';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

interface EditPredictionDemoProps {
  prerenderedFile: PreloadedFileResult<undefined, undefined>;
  prerenderedDiff: PreloadFileDiffResult<undefined, undefined>;
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
const statusTextMap = {
  idle: 'Idle',
  waiting: 'Waiting...',
  predicting: 'Predicting...',
  empty: 'No suggestion returned. Keep editing to try again.',
  error: 'Prediction unavailable. Check the demo service and try again.',
};
const readyStatusText = {
  eager: (
    <>
      Prediction ready — press <kbd>Tab</kbd> to accept.
    </>
  ),
  subtle: (
    <>
      Prediction ready — hold <kbd>Alt</kbd> and press <kbd>Tab</kbd> to accept.
    </>
  ),
};

export function EditPredictionDemo({
  prerenderedFile,
  prerenderedDiff,
}: EditPredictionDemoProps) {
  const editorRef = useRef<Editor<EditorType, undefined, undefined> | null>(
    null
  );
  const predictionEnabledRef = useRef(false);
  const [attached, setAttached] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [githubAuthenticated, setGithubAuthenticated] = useState(false);
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
          const response = await fetch('/edit/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal,
          });
          if (response.status === 401) {
            window.location.assign('/edit/auth');
            throw new Error('GitHub sign-in required');
          }
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
  const editorOptions = useMemo<
    EditorOptions<EditorType, undefined, undefined>
  >(
    () => ({
      editPrediction,
      onAttach(editor) {
        editorRef.current = editor;
        setAttached(true);
      },
      onChange({ file }) {
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

  useEffect(() => {
    const controller = new AbortController();

    void fetch('/edit/auth', {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) {
          setGithubAuthenticated(response.status === 204);
        }
      })
      .catch(() => {
        // Keep the safe default: the button starts the GitHub connection flow.
        if (!controller.signal.aborted) {
          setGithubAuthenticated(false);
        }
      });

    return () => controller.abort();
  }, []);

  const placeCursor = useCallback(() => {
    const editor = editorRef.current;
    if (editor == null) {
      return;
    }
    const anchor = 'return items.';
    const lines = editor.getText().split(/\r\n|\r|\n/);
    const line = lines.findIndex((text) => text.includes(anchor));
    if (line < 0) {
      return;
    }
    const character = lines[line].indexOf(anchor) + anchor.length;
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

  const tryCodestral = useCallback(async () => {
    setAuthenticating(true);
    try {
      const response = await fetch('/edit/auth', {
        method: 'HEAD',
        cache: 'no-store',
      });
      if (response.status === 401) {
        setGithubAuthenticated(false);
        window.location.assign('/edit/auth');
        return;
      }
      if (!response.ok) {
        setStatus('error');
        return;
      }
      setGithubAuthenticated(true);
      placeCursor();
    } catch {
      setStatus('error');
    } finally {
      setAuthenticating(false);
    }
  }, [placeCursor]);

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

  const statusText = authenticating
    ? 'Checking GitHub sign-in…'
    : status === 'error'
      ? statusTextMap.error
      : !predictionEnabled
        ? null
        : status === 'ready'
          ? readyStatusText[mode]
          : statusTextMap[status];

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

        <Button
          variant="outline"
          onClick={reset}
          disabled={!hasEdits && !predictionEnabled}
        >
          <IconRefresh />
          Reset
        </Button>

        <div className="flex basis-full items-center justify-start gap-3 md:ml-auto md:basis-auto md:justify-end">
          {statusText !== null && (
            <span
              className="text-muted-foreground text-xs"
              role="status"
              aria-live="polite"
            >
              {statusText}
            </span>
          )}
          {!predictionEnabled && (
            <Button
              variant="outline"
              onClick={() => void tryCodestral()}
              disabled={!attached || authenticating}
            >
              {githubAuthenticated ? <CodestralIcon /> : <IconBrandGithub />}
              {githubAuthenticated
                ? 'Continue with Codestral'
                : 'Connect GitHub'}
            </Button>
          )}
        </div>
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
