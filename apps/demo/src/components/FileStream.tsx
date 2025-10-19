import {
  FileStream as FileStreamClass,
  type FileStreamOptions,
} from '@pierre/precision-diffs';
import { useEffect, useRef, useState } from 'react';

export type { FileStreamOptions };

export interface FileStreamProps {
  stream: ReadableStream<string>;
  options: FileStreamOptions;
}

export function FileStream({ stream, options }: FileStreamProps) {
  const [fileStream] = useState(() => new FileStreamClass(options));
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current == null) return;
    void fileStream.setup(stream, ref.current);
    return () => fileStream.cleanUp();
  }, [fileStream]);
  return <pre ref={ref} />;
}
