import {
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import { FileDiff, type FileDiffOptions } from '../../components/FileDiff';
import { VirtualizedFileDiff } from '../../components/VirtualizedFileDiff';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
  VirtualFileMetrics,
} from '../../types';
import { areDiffTargetsEqual } from '../../utils/areDiffTargetsEqual';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
import { noopRender } from '../constants';
import { useEditor } from '../EditorContext';
import { useVirtualizer } from '../Virtualizer';
import { WorkerPoolContext } from '../WorkerPoolContext';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseFileDiffInstanceProps<LAnnotation> {
  fileDiff: FileDiffMetadata;
  options: FileDiffOptions<LAnnotation> | undefined;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
  contentEditable: boolean;
}

interface UseFileDiffInstanceReturn {
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
}

interface HydratedDiffRefState {
  fileDiff: FileDiffMetadata;
  hydratedFileDiff: FileDiffMetadata | undefined;
}

type OnHydratedPartialDiff<LAnnotation> = NonNullable<
  FileDiffOptions<LAnnotation>['onHydratedPartialDiff']
>;

export function useFileDiffInstance<LAnnotation>({
  fileDiff,
  options,
  lineAnnotations,
  selectedLines,
  prerenderedHTML,
  metrics,
  hasGutterRenderUtility,
  hasCustomHeader,
  disableWorkerPool,
  contentEditable,
}: UseFileDiffInstanceProps<LAnnotation>): UseFileDiffInstanceReturn {
  const simpleVirtualizer = useVirtualizer();
  const controlledSelection = selectedLines !== undefined;
  const poolManager = useContext(WorkerPoolContext);
  const editor = useEditor<LAnnotation>();
  const instanceRef = useRef<
    FileDiff<LAnnotation> | VirtualizedFileDiff<LAnnotation> | null
  >(null);
  const hydratedDiffRef = useRef<HydratedDiffRefState>({
    fileDiff,
    hydratedFileDiff: undefined,
  });
  const onHydratedPartialDiff = useStableCallback<
    OnHydratedPartialDiff<LAnnotation>
  >((sourceFileDiff, hydratedFileDiff, instance) => {
    syncHydratedDiffFromCommit(
      hydratedDiffRef,
      sourceFileDiff,
      hydratedFileDiff
    );
    options?.onHydratedPartialDiff?.(
      sourceFileDiff,
      hydratedFileDiff,
      instance
    );
  });
  const ref = useStableCallback((fileContainer: HTMLElement | null) => {
    if (fileContainer != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'useFileDiffInstance: An instance should not already exist when a node is created'
        );
      }
      if (simpleVirtualizer != null) {
        instanceRef.current = new VirtualizedFileDiff(
          mergeFileDiffOptions({
            controlledSelection,
            contentEditable,
            hasCustomHeader,
            hasEditor: editor !== undefined,
            hasGutterRenderUtility,
            onHydratedPartialDiff,
            options,
          }),
          simpleVirtualizer,
          metrics,
          !disableWorkerPool ? poolManager : undefined,
          true
        );
      } else {
        instanceRef.current = new FileDiff(
          mergeFileDiffOptions({
            controlledSelection,
            contentEditable,
            hasCustomHeader,
            hasEditor: editor !== undefined,
            hasGutterRenderUtility,
            onHydratedPartialDiff,
            options,
          }),
          !disableWorkerPool ? poolManager : undefined,
          true
        );
      }
      void instanceRef.current.hydrate({
        fileDiff,
        fileContainer,
        lineAnnotations,
        prerenderedHTML,
      });
    } else {
      if (instanceRef.current == null) {
        throw new Error(
          'useFileDiffInstance: A FileDiff instance should exist when unmounting'
        );
      }
      instanceRef.current.cleanUp();
      instanceRef.current = null;
    }
  });

  useIsometricEffect(() => {
    const { current: instance } = instanceRef;
    if (instance == null) return;
    const renderableFileDiff = resolveRenderableFileDiff(
      hydratedDiffRef,
      fileDiff
    );
    const newOptions = mergeFileDiffOptions({
      controlledSelection,
      contentEditable,
      hasCustomHeader,
      hasEditor: editor !== undefined,
      hasGutterRenderUtility,
      onHydratedPartialDiff,
      options,
    });
    const forceRender = !areOptionsEqual(instance.options, newOptions);
    instance.setOptions(newOptions);
    void instance.render({
      forceRender,
      fileDiff: renderableFileDiff,
      lineAnnotations,
    });
    if (selectedLines !== undefined) {
      instance.setSelectedLines(selectedLines);
    }
  });

  useIsometricEffect(() => {
    if (contentEditable && instanceRef.current != null) {
      if (editor === undefined) {
        throw new Error('FileDiff: Editor is not attached');
      }
      return editor.edit(instanceRef.current);
    }
    return undefined;
  }, [contentEditable, editor]);

  const getHoveredLine = useCallback(():
    | GetHoveredLineResult<'diff'>
    | undefined => {
    return instanceRef.current?.getHoveredLine();
  }, []);

  return { ref, getHoveredLine };
}

function syncHydratedDiffFromCommit(
  hydratedDiffRef: RefObject<HydratedDiffRefState>,
  sourceFileDiff: FileDiffMetadata,
  hydratedFileDiff: FileDiffMetadata
): void {
  const trackedState = hydratedDiffRef.current;
  if (
    !trackedState.fileDiff.isPartial ||
    hydratedFileDiff.isPartial ||
    trackedState.hydratedFileDiff === hydratedFileDiff ||
    (sourceFileDiff !== trackedState.fileDiff &&
      !areDiffTargetsEqual(sourceFileDiff, trackedState.fileDiff))
  ) {
    return;
  }

  hydratedDiffRef.current = {
    fileDiff: trackedState.fileDiff,
    hydratedFileDiff,
  };
}

function resolveRenderableFileDiff(
  hydratedDiffRef: RefObject<HydratedDiffRefState>,
  fileDiff: FileDiffMetadata
): FileDiffMetadata {
  const { current: trackedState } = hydratedDiffRef;
  const renderableFileDiff =
    trackedState.hydratedFileDiff ?? trackedState.fileDiff;

  if (!fileDiff.isPartial) {
    if (trackedState.fileDiff !== fileDiff) {
      hydratedDiffRef.current = {
        fileDiff,
        hydratedFileDiff: undefined,
      };
    }
    return fileDiff;
  }

  if (areDiffTargetsEqual(trackedState.fileDiff, fileDiff)) {
    if (!renderableFileDiff.isPartial) {
      return renderableFileDiff;
    }
    if (trackedState.fileDiff !== fileDiff) {
      hydratedDiffRef.current = {
        fileDiff,
        hydratedFileDiff: undefined,
      };
    }
    return fileDiff;
  }

  if (!renderableFileDiff.isPartial) {
    throw new Error(
      'useFileDiffInstance: Cannot replace a rendered full diff with a different partial diff.'
    );
  }

  hydratedDiffRef.current = {
    fileDiff,
    hydratedFileDiff: undefined,
  };
  return fileDiff;
}

interface MergeFileDiffOptionsProps<LAnnotation> {
  controlledSelection: boolean;
  contentEditable: boolean;
  hasEditor: boolean;
  hasCustomHeader: boolean;
  hasGutterRenderUtility: boolean;
  onHydratedPartialDiff: OnHydratedPartialDiff<LAnnotation>;
  options: FileDiffOptions<LAnnotation> | undefined;
}

function mergeFileDiffOptions<LAnnotation>({
  options,
  controlledSelection,
  contentEditable,
  hasCustomHeader,
  hasEditor,
  hasGutterRenderUtility,
  onHydratedPartialDiff,
}: MergeFileDiffOptionsProps<LAnnotation>):
  | FileDiffOptions<LAnnotation>
  | undefined {
  const needsEditorOptions = contentEditable && hasEditor;
  const needsReactOverrides =
    controlledSelection || hasGutterRenderUtility || hasCustomHeader;
  const needsOnHydratedHandler = options?.loadDiffFiles != null;

  if (!needsReactOverrides && !needsEditorOptions && !needsOnHydratedHandler) {
    return options;
  }

  return {
    ...options,
    ...(needsReactOverrides
      ? {
          controlledSelection,
          renderCustomHeader: hasCustomHeader
            ? noopRender
            : options?.renderCustomHeader,
          renderGutterUtility: hasGutterRenderUtility
            ? noopRender
            : options?.renderGutterUtility,
        }
      : null),
    ...(needsEditorOptions
      ? {
          useTokenTransformer: true,
          enableGutterUtility: false,
          enableLineSelection: false,
          expandUnchanged: true,
          lineHoverHighlight: 'disabled',
        }
      : null),
    ...(needsOnHydratedHandler ? { onHydratedPartialDiff } : null),
  };
}
