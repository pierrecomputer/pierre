import type { RenderRange } from '../types';

export const FILE_ANNOTATION_LINE_NUMBER = 0;
export const FILE_ANNOTATION_HUNK_INDEX = -1;
export const FILE_ANNOTATION_LINE_INDEX = -1;
export const FILE_ANNOTATION_DOM_KEY: string = `${FILE_ANNOTATION_HUNK_INDEX},${FILE_ANNOTATION_LINE_INDEX}`;

type AnnotationLineMap<TAnnotation> = Record<number, TAnnotation[] | undefined>;
type FileLevelAnnotationLike = { lineNumber: number };

export function includesFileAnnotations(
  annotations: readonly FileLevelAnnotationLike[] | undefined
): boolean {
  return (
    annotations?.some(
      (annotation) => annotation.lineNumber === FILE_ANNOTATION_LINE_NUMBER
    ) ?? false
  );
}

export function getFileAnnotations<TAnnotation>(
  annotations: AnnotationLineMap<TAnnotation>
): TAnnotation[] | undefined {
  const fileAnnotations = annotations[FILE_ANNOTATION_LINE_NUMBER];
  return fileAnnotations != null && fileAnnotations.length > 0
    ? fileAnnotations
    : undefined;
}

export function shouldRenderFileAnnotations(renderRange: RenderRange): boolean {
  return (
    renderRange.startingLine === FILE_ANNOTATION_LINE_NUMBER &&
    renderRange.totalLines > 0
  );
}
