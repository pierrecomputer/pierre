import deepEqual from 'fast-deep-equal';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import { type FileOptions, File as FileUI } from '../File';
import { HEADER_METADATA_SLOT_ID } from '../constants';
import type { FileContents, LineAnnotation } from '../types';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';

export type { FileContents };

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface FileProps<LAnnotation> {
  file: FileContents;
  options: FileOptions<LAnnotation>;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: LineAnnotation<LAnnotation>): ReactNode;
  renderHeaderMetadata?(file: FileContents): ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function File<LAnnotation = undefined>({
  file,
  lineAnnotations,
  options,
  className,
  style,
  renderAnnotation,
  renderHeaderMetadata,
}: FileProps<LAnnotation>) {
  const instanceRef = useRef<FileUI<LAnnotation> | null>(null);
  const ref = useRef<HTMLElement>(null);

  useIsometricEffect(() => {
    if (ref.current == null) return;
    instanceRef.current ??= new FileUI<LAnnotation>(options, true);
    const forceRender = !deepEqual(instanceRef.current.options, options);
    instanceRef.current.setOptions(options);
    void instanceRef.current.render({
      file,
      fileContainer: ref.current,
      lineAnnotations,
      forceRender,
    });
  });
  useIsometricEffect(
    () => () => {
      instanceRef.current?.cleanUp();
      instanceRef.current = null;
    },
    []
  );

  const metadata = renderHeaderMetadata?.(file);
  return (
    <file-diff ref={ref} className={className} style={style}>
      {metadata != null && <div slot={HEADER_METADATA_SLOT_ID}>{metadata}</div>}
      {renderAnnotation != null &&
        lineAnnotations?.map((annotation, index) => (
          <div key={index} slot={getLineAnnotationName(annotation)}>
            {renderAnnotation(annotation)}
          </div>
        ))}
    </file-diff>
  );
}
