'use client';

import {
  type FileContents,
  type FileOptions,
  File as FileUI,
  type LineAnnotation,
} from '@pierre/precision-diffs';
import deepEqual from 'fast-deep-equal';
import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

interface FileProps<LAnnotation> {
  file: FileContents;
  options: FileOptions<LAnnotation>;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: LineAnnotation<LAnnotation>): ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function File<LAnnotations = undefined>({
  file,
  lineAnnotations,
  options,
  className,
  style,
}: FileProps<LAnnotations>) {
  const [fileInstance] = useState(() => new FileUI(options));
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (ref.current == null) return;
    const forceRender = !deepEqual(fileInstance.options, options);
    fileInstance.setOptions(options);
    void fileInstance.render({
      file,
      fileContainer: ref.current,
      lineAnnotations,
      forceRender,
    });
  });

  return <pjs-container ref={ref} className={className} style={style} />;
}
