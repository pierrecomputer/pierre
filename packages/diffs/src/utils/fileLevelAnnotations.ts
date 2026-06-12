import type { RenderRange } from '../types';

export const FILE_LEVEL_ANNOTATION_LINE_NUMBER = 0;

type AnnotationLineMap<TAnnotation> = Record<number, TAnnotation[] | undefined>;

export function getFileLevelAnnotations<TAnnotation>(
  annotations: AnnotationLineMap<TAnnotation>
): TAnnotation[] | undefined {
  const fileLevelAnnotations = annotations[FILE_LEVEL_ANNOTATION_LINE_NUMBER];
  return fileLevelAnnotations != null && fileLevelAnnotations.length > 0
    ? fileLevelAnnotations
    : undefined;
}

export function shouldRenderFileLevelAnnotations(
  renderRange: RenderRange
): boolean {
  return (
    renderRange.startingLine === FILE_LEVEL_ANNOTATION_LINE_NUMBER &&
    renderRange.totalLines > 0
  );
}
