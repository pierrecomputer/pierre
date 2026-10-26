'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

import { createDomRenderer } from '../html/dom';
import { createHtmlRenderer } from '../html/render';
import type { AnimateOptions, HtmlOptions } from '../html/types';

export { defaultUrlTransform } from '../html/render';
export type * from '../html/types';

export interface MarkdownProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'>, HtmlOptions {
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

/** React owns one opaque container; the framework-independent renderer owns its HTML. */
export function Markdown({
  children = '',
  mode = 'streaming',
  isAnimating = false,
  animated = false,
  parseIncompleteMarkdown = true,
  components,
  plugins,
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
  const options: HtmlOptions = {
    components,
    plugins,
    controls,
    lineNumbers,
    allowedElements,
    disallowedElements,
    unwrapDisallowed,
    urlTransform,
    idPrefix: idPrefix ?? `${id}-`,
  };
  const incomplete = mode === 'streaming' && parseIncompleteMarkdown;
  const active = mode === 'streaming' && isAnimating;
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
    renderer.current?.update(children, incomplete, active, animated, caret);
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
  return (
    <div
      {...props}
      ref={root}
      data-markdown="root"
      data-streaming={active || undefined}
      dangerouslySetInnerHTML={initial.markup}
    />
  );
}
