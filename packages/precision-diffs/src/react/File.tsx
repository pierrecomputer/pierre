'use client';

import { type CSSProperties, type ReactNode } from 'react';

import { type FileOptions } from '../File';
import { HEADER_METADATA_SLOT_ID } from '../constants';
import type { FileContents, LineAnnotation } from '../types';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { templateRender } from './utils/templateRender';
import { useFileInstance } from './utils/useFileInstance';

export type { FileOptions };

export interface FileProps<LAnnotation> {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: LineAnnotation<LAnnotation>): ReactNode;
  renderHeaderMetadata?(file: FileContents): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
}

export function File<LAnnotation = undefined>({
  file,
  lineAnnotations,
  options,
  className,
  style,
  renderAnnotation,
  renderHeaderMetadata,
  prerenderedHTML,
}: FileProps<LAnnotation>): React.JSX.Element {
  const ref = useFileInstance({ file, options, lineAnnotations });
  const metadata = renderHeaderMetadata?.(file);
  const children = (
    <>
      {metadata != null && <div slot={HEADER_METADATA_SLOT_ID}>{metadata}</div>}
      {renderAnnotation != null &&
        lineAnnotations?.map((annotation, index) => (
          <div key={index} slot={getLineAnnotationName(annotation)}>
            {renderAnnotation(annotation)}
          </div>
        ))}
    </>
  );
  return (
    <file-diff ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </file-diff>
  );
}
