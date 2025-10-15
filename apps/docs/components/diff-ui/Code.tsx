'use client';

import {
  CodeRenderer,
  type CodeRendererOptions,
} from '@pierre/diff-ui';
import deepEqual from 'fast-deep-equal';
import {
  type CSSProperties,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

interface CodeProps {
  text: string;
  options: CodeRendererOptions;
  className?: string;
  style?: CSSProperties;
}

export function Code({ text, options, className, style }: CodeProps) {
  const [codeRenderer] = useState(() => new CodeRenderer(options));
  const ref = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  const textRef = useRef('');

  useLayoutEffect(() => {
    const hasTextChange = textRef.current !== text;

    let hasOptionsChange = false;
    if (!deepEqual(optionsRef.current, options)) {
      optionsRef.current = options;
      hasOptionsChange = true;
    }

    if (hasTextChange || hasOptionsChange || ref.current != null) {
      textRef.current = text;
      if (ref.current != null) {
        void codeRenderer.setup(text, ref.current);
      }
    }
  });

  return (
    <div ref={ref} className={className} style={style} />
  );
}
