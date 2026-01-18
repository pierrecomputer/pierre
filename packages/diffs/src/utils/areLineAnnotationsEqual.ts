import type { LineAnnotation } from '../types';

export function areLineAnnotationsEqual<LAnnotation = undefined>(
  annotationA: LineAnnotation<LAnnotation>,
  annotationB: LineAnnotation<LAnnotation>
): boolean {
  return (
    annotationA.lineNumber === annotationB.lineNumber &&
    annotationA.metadata === annotationB.metadata
  );
}
