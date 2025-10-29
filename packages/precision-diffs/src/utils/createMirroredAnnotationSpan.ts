import type { AnnotationLineMap, AnnotationSpan } from '../types';
import { getLineAnnotationName } from './getLineAnnotationName';

interface CreateMirroredAnnotationSpanProps<LAnnotation> {
  deletionLineNumber: number;
  additionLineNumber: number;
  hunkIndex: number;
  lineIndex: number;
  deletionAnnotations: AnnotationLineMap<LAnnotation>;
  additionAnnotations: AnnotationLineMap<LAnnotation>;
}

export function createMirroredAnnotationSpan<LAnnotation>(
  props: CreateMirroredAnnotationSpanProps<LAnnotation> & { unified: true }
): AnnotationSpan | undefined;
export function createMirroredAnnotationSpan<LAnnotation>(
  props: CreateMirroredAnnotationSpanProps<LAnnotation> & { unified: false }
): [AnnotationSpan, AnnotationSpan] | [undefined, undefined];
export function createMirroredAnnotationSpan<LAnnotation>({
  deletionLineNumber,
  additionLineNumber,
  hunkIndex,
  lineIndex,
  deletionAnnotations,
  additionAnnotations,
  unified,
}: CreateMirroredAnnotationSpanProps<LAnnotation> & { unified: boolean }):
  | [AnnotationSpan, AnnotationSpan]
  | [undefined, undefined]
  | AnnotationSpan
  | undefined {
  const dAnnotations: string[] = [];
  for (const anno of deletionAnnotations[deletionLineNumber] ?? []) {
    dAnnotations.push(getLineAnnotationName(anno));
  }
  const aAnnotations: string[] = [];
  for (const anno of additionAnnotations[additionLineNumber] ?? []) {
    (unified ? dAnnotations : aAnnotations).push(getLineAnnotationName(anno));
  }
  if (aAnnotations.length === 0 && dAnnotations.length === 0) {
    if (unified) {
      return undefined;
    }
    return [undefined, undefined];
  }
  if (unified) {
    return {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: dAnnotations,
    };
  }
  return [
    {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: dAnnotations,
    },
    {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: aAnnotations,
    },
  ];
}
