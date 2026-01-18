import type { DiffLineAnnotation } from 'src/types';

export function areDiffLineAnnotationsEqual<LAnnotation = undefined>(
  annotationA: DiffLineAnnotation<LAnnotation>,
  annotationB: DiffLineAnnotation<LAnnotation>
): boolean {
  return (
    annotationA.lineNumber === annotationB.lineNumber &&
    annotationA.side === annotationB.side &&
    annotationA.metadata === annotationB.metadata
  );
}
