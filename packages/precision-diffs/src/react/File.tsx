'use client';

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
import { templateRender } from './utils/templateRender';
import { useStableCallback } from './utils/useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

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
}: FileProps<LAnnotation>) {
  const instanceRef = useRef<FileUI<LAnnotation> | null>(null);
  const ref = useStableCallback((node: HTMLElement | null) => {
    if (node != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'File: An instance should not already exist when a node is created'
        );
      }
      // FIXME: Ideally we don't use FileUI here, and instead amalgamate
      // the renderers manually
      instanceRef.current = new FileUI(options, true);
      instanceRef.current.hydrate({
        file,
        fileContainer: node,
        lineAnnotations,
      });
    } else {
      if (instanceRef.current == null) {
        throw new Error('File: A File instance should exist when unmounting');
      }
      instanceRef.current.cleanUp();
      instanceRef.current = null;
    }
  });

  useIsometricEffect(() => {
    if (instanceRef.current == null) return;
    const forceRender = !deepEqual(instanceRef.current.options, options);
    instanceRef.current.setOptions(options);
    void instanceRef.current.render({
      file,
      lineAnnotations,
      forceRender,
    });
  });
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
