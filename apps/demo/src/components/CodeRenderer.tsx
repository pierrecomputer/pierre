import {
  CodeRenderer as CodeRendererClass,
  type CodeRendererOptions,
} from '@pierre/diff-ui';
import { useEffect, useRef, useState } from 'react';

export type { CodeRendererOptions };

export interface CodeRendererProps {
  stream: ReadableStream<string>;
  options: CodeRendererOptions;
}

export function CodeRenderer({ stream, options }: CodeRendererProps) {
  const [codeRenderer] = useState(() => new CodeRendererClass(options));
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current != null) {
      void codeRenderer.setup(stream, ref.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <pre ref={ref} />;
}
