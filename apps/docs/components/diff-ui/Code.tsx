'use client';

import { FileStream, type FileStreamOptions } from '@pierre/precision-diffs';
import deepEqual from 'fast-deep-equal';
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';

interface CodeProps {
  text: string;
  options: FileStreamOptions;
  className?: string;
  style?: CSSProperties;
}

export function Code({ text, options, className, style }: CodeProps) {
  const [fileStream] = useState(() => new FileStream(options));
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
        void fileStream.setup(text, ref.current);
      }
    }
  });

  return <div ref={ref} className={className} style={style} />;
}
