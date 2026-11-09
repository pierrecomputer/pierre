import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import { areOptionsEqual } from '../../utils/areOptionsEqual';
import type { SnippetLineRange } from '../../utils/snippetClip';
import type { WorkerPoolManager } from '../../worker';
import { noopRender } from '../constants';
import { useVirtualizer } from '../Virtualizer';
import { WorkerPoolContext } from '../WorkerPoolContext';
import { useForceUpdate } from './useForceUpdate';
import { useStableCallback } from './useStableCallback';

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface SnippetOptionsBase {
  lineRange: SnippetLineRange;
  controlledSelection?: boolean;
  renderCustomHeader?: unknown;
  renderGutterUtility?: unknown;
}

interface SnippetInstance<TOptions, TRenderProps, THydrateProps, THovered> {
  options: TOptions;
  setOptions(options: TOptions): void;
  render(props: TRenderProps): boolean;
  hydrate(props: THydrateProps): void;
  setSelectedLines(range: never): void;
  getHoveredLine(): THovered | undefined;
  cleanUp(): void;
}

interface UseSnippetInstanceProps<TInstance, TOptions, TRenderProps> {
  /** Component name for error messages. */
  name: string;
  options: TOptions;
  create(
    options: TOptions,
    workerManager: WorkerPoolManager | undefined,
    requestOwnerRender: () => void
  ): TInstance;
  /** What render() and hydrate() receive, minus the container. */
  renderProps: TRenderProps;
  selectedLines: unknown;
  prerenderedHTML: string | undefined;
  hasCustomHeader: boolean;
  hasGutterRenderUtility: boolean;
  disableWorkerPool: boolean;
}

/**
 * The React lifecycle shared by the snippet components: one instance per
 * mounted node, hydrated from `prerenderedHTML`, re-rendered in a layout
 * effect. Snippets are read-only (no editor) and not virtualized, so this is
 * much smaller than the FileDiff/File hooks, which it leaves untouched.
 */
export function useSnippetInstance<
  TInstance extends SnippetInstance<TOptions, TRenderProps, never, THovered>,
  TOptions extends SnippetOptionsBase,
  TRenderProps extends object,
  THovered,
>({
  name,
  options,
  create,
  renderProps,
  selectedLines,
  prerenderedHTML,
  hasCustomHeader,
  hasGutterRenderUtility,
  disableWorkerPool,
}: UseSnippetInstanceProps<TInstance, TOptions, TRenderProps>): {
  ref(node: HTMLElement | null): void;
  getInstance(): TInstance | undefined;
  getHoveredLine(): THovered | undefined;
} {
  if (useVirtualizer() != null) {
    throw new Error(
      `${name}: snippets cannot render inside a <Virtualizer>; render them outside it, or use FileDiff/File for virtualized lists`
    );
  }
  const poolManager = useContext(WorkerPoolContext);
  const forceUpdate = useForceUpdate();
  const instanceRef = useRef<TInstance | null>(null);
  const controlledSelection = selectedLines !== undefined;
  const mergedOptions = (): TOptions => ({
    ...options,
    controlledSelection,
    renderCustomHeader: hasCustomHeader
      ? noopRender
      : options.renderCustomHeader,
    renderGutterUtility: hasGutterRenderUtility
      ? noopRender
      : options.renderGutterUtility,
  });

  const ref = useStableCallback((fileContainer: HTMLElement | null) => {
    if (fileContainer != null) {
      instanceRef.current = create(
        mergedOptions(),
        !disableWorkerPool ? poolManager : undefined,
        forceUpdate
      );
      instanceRef.current.hydrate({
        ...renderProps,
        fileContainer,
        prerenderedHTML,
      } as never);
    } else {
      instanceRef.current?.cleanUp();
      instanceRef.current = null;
    }
  });

  useIsomorphicLayoutEffect(() => {
    const instance = instanceRef.current;
    if (instance == null) return;
    const next = mergedOptions();
    const forceRender = !areSnippetOptionsEqual(instance.options, next);
    instance.setOptions(next);
    instance.render({ ...renderProps, forceRender });
    if (selectedLines !== undefined) {
      instance.setSelectedLines(selectedLines as never);
    }
  });

  const getInstance = useCallback(() => instanceRef.current ?? undefined, []);
  const getHoveredLine = useCallback(
    () => instanceRef.current?.getHoveredLine(),
    []
  );
  return { ref, getInstance, getHoveredLine };
}

// A `lineRange` written inline is a new object each render; compare it by
// value so an unchanged range keeps the reader's reveals and skips a render.
function areSnippetOptionsEqual(
  previous: SnippetOptionsBase,
  next: SnippetOptionsBase
): boolean {
  return (
    previous.lineRange.start === next.lineRange.start &&
    previous.lineRange.end === next.lineRange.end &&
    areOptionsEqual(
      { ...previous, lineRange: undefined } as never,
      { ...next, lineRange: undefined } as never
    )
  );
}
