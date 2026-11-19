'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { createDomRenderer } from '../html/dom';
import { type MountedIsland, noIslands } from '../html/islands';
import { createHtmlRenderer } from '../html/render';
import type {
  AnimateOptions,
  HtmlIsland,
  HtmlOptions,
  IslandData,
} from '../html/types';

export { defaultUrlTransform } from '../lib/utils';
export type * from '../html/types';

export interface ReactiveIsland extends Pick<
  HtmlIsland,
  'fallback' | 'pending'
> {
  /** Return a React element, or null to keep the original code fence. */
  render(data: IslandData): ReactElement | null;
}

export type ReactiveIslands = Readonly<Record<string, ReactiveIsland>>;

export interface MarkdownProps
  extends
    Omit<HTMLAttributes<HTMLDivElement>, 'children'>,
    Omit<HtmlOptions, 'islands'> {
  /** Components available to island-NAME fences. */
  islands?: ReactiveIslands;
  children?: string;
  mode?: 'streaming' | 'static';
  isAnimating?: boolean;
  animated?: boolean | AnimateOptions;
  parseIncompleteMarkdown?: boolean;
  caret?: 'block' | 'circle';
  onAnimationStart?: () => void;
  onAnimationEnd?: () => void;
}

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;
const subscribe = (): (() => void) => () => {};

function IslandPortal({
  island,
  definition,
}: {
  island: MountedIsland;
  definition: ReactiveIsland;
}): ReactNode {
  const element = definition.render(island.data);
  const { fallback } = island;
  const mounted = element !== null;
  useIsomorphicLayoutEffect(() => {
    fallback.toggleAttribute('hidden', mounted);
    return () => {
      fallback.removeAttribute('hidden');
    };
  }, [fallback, mounted]);
  return createPortal(element, island.content);
}

/** React owns the container, and `createDomRenderer` owns its content. */
export function Markdown({
  children = '',
  mode = 'streaming',
  isAnimating = false,
  animated = false,
  parseIncompleteMarkdown = true,
  components,
  plugins,
  islands,
  cjk,
  math,
  controls = true,
  lineNumbers = true,
  caret,
  allowedElements,
  disallowedElements,
  unwrapDisallowed,
  urlTransform,
  idPrefix,
  onAnimationStart,
  onAnimationEnd,
  ...props
}: MarkdownProps): ReactNode {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const renderer = useRef<ReturnType<typeof createDomRenderer> | undefined>(
    undefined
  );
  // False only while hydrating server HTML, which is already visible and must not fade in.
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const [mountedIslands, setMountedIslands] = useState(noIslands);
  const islandOptions = useMemo<HtmlOptions['islands']>(
    () =>
      islands === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(islands).map(([name, definition]) => [
              name,
              {
                fallback: definition.fallback,
                pending: definition.pending,
                accepts: (data: IslandData) => definition.render(data) !== null,
              },
            ])
          ),
    [islands]
  );
  const options: HtmlOptions = {
    components,
    plugins,
    islands: islandOptions,
    cjk,
    math,
    controls,
    lineNumbers,
    allowedElements,
    disallowedElements,
    unwrapDisallowed,
    urlTransform,
    idPrefix: idPrefix ?? `${id}-`,
  };
  const active = mode === 'streaming' && isAnimating;
  // Completion guesses what the stream will send, so finished text never uses it.
  const incomplete = active && parseIncompleteMarkdown;
  const [initial] = useState(() => {
    const initial = createHtmlRenderer(options);
    try {
      return {
        markup: { __html: initial.render(children, incomplete, active).html },
        options,
        formatter: initial,
      };
    } finally {
      initial.dispose();
    }
  });
  useIsomorphicLayoutEffect(() => {
    if (root.current === null) return;
    renderer.current ??= createDomRenderer(
      root.current,
      initial.options,
      initial.formatter
    );
    renderer.current.connect();
    return () => renderer.current?.disconnect();
  }, [initial]);
  useIsomorphicLayoutEffect(() => {
    renderer.current?.configure(options);
    renderer.current?.update(
      children,
      incomplete,
      active,
      hydrated ? animated : false,
      caret
    );
    if (islands !== undefined || mountedIslands.length !== 0) {
      const next = renderer.current?.getIslands() ?? noIslands;
      if (next !== mountedIslands) setMountedIslands(next);
    }
  });
  const callbacks = useRef({ onAnimationStart, onAnimationEnd });
  useEffect(() => {
    callbacks.current = { onAnimationStart, onAnimationEnd };
  }, [onAnimationStart, onAnimationEnd]);
  useEffect(() => {
    if (!active) return;
    callbacks.current.onAnimationStart?.();
    return () => callbacks.current.onAnimationEnd?.();
  }, [active]);
  const container = (
    <div
      {...props}
      ref={root}
      data-markdown="root"
      data-streaming={active || undefined}
      dangerouslySetInnerHTML={initial.markup}
    />
  );
  if (mountedIslands.length === 0 || islands === undefined) return container;
  return (
    <>
      {container}
      {mountedIslands.map((island) =>
        Object.hasOwn(islands, island.name) ? (
          <IslandPortal
            key={island.key}
            island={island}
            definition={islands[island.name]}
          />
        ) : null
      )}
    </>
  );
}
