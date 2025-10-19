import type { DiffLineAnnotation, LineAnnotation } from '../types';

export function getLineAnnotationId<T = undefined>(
  annotation: LineAnnotation<T> | DiffLineAnnotation<T>
): string {
  return `annotation-${'side' in annotation ? `${annotation.side}-` : ''}${annotation.lineNumber}`;
}
