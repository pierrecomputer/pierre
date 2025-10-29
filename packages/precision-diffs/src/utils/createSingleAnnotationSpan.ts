import type { AnnotationLineMap, AnnotationSpan } from '../types';
import { getLineAnnotationName } from './getLineAnnotationName';

interface CreateSingleAnnotationProps<LAnnotation> {
  hunkIndex: number;
  lineIndex: number;
  rowNumber: number;
  annotationMap: AnnotationLineMap<LAnnotation>;
}

export function createSingleAnnotationSpan<LAnnotation>({
  rowNumber,
  hunkIndex,
  lineIndex,
  annotationMap,
}: CreateSingleAnnotationProps<LAnnotation>): AnnotationSpan | undefined {
  const span: AnnotationSpan = {
    type: 'annotation',
    hunkIndex,
    lineIndex,
    annotations: [],
  };
  for (const anno of annotationMap[rowNumber] ?? []) {
    span.annotations.push(getLineAnnotationName(anno));
  }
  return span.annotations.length > 0 ? span : undefined;
}
