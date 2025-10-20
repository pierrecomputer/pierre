'use client';

import {
  type FileContents,
  type FileOptions,
  File as FileUI,
  HEADER_METADATA_SLOT_ID,
  type LineAnnotation,
  getLineAnnotationId,
} from '@pierre/precision-diffs';
import deepEqual from 'fast-deep-equal';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

interface FileProps<LAnnotation> {
  file: FileContents;
  options: FileOptions<LAnnotation>;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: LineAnnotation<LAnnotation>): ReactNode;
  renderHeaderMetadata?(file: FileContents): ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function File<LAnnotations = undefined>({
  file,
  lineAnnotations,
  options,
  className,
  style,
  renderAnnotation,
  renderHeaderMetadata,
}: FileProps<LAnnotations>) {
  const [fileInstance] = useState(() => new FileUI(options, true));
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
  useEffect(() => () => fileInstance.cleanUp(), [fileInstance]);

  const metadata = renderHeaderMetadata?.(file);
  return (
    <pjs-container ref={ref} className={className} style={style}>
      {metadata != null && <div slot={HEADER_METADATA_SLOT_ID}>{metadata}</div>}
      {renderAnnotation != null &&
        lineAnnotations?.map((annotation) => (
          <div
            key={getLineAnnotationId(annotation)}
            slot={getLineAnnotationId(annotation)}
          >
            {renderAnnotation(annotation)}
          </div>
        ))}
    </pjs-container>
  );
}
