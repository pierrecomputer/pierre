import type { DiffLineAnnotation, LineAnnotation } from '../types';

/** Narrow an annotation to the side-tagged diff shape. */
export function isDiffAnnotation<LAnnotation = undefined>(
  annotation: LineAnnotation<LAnnotation> | DiffLineAnnotation<LAnnotation>
): annotation is DiffLineAnnotation<LAnnotation> {
  return 'side' in annotation;
}

/** Narrow an annotation to the side-less file shape. */
export function isFileAnnotation<LAnnotation = undefined>(
  annotation: LineAnnotation<LAnnotation> | DiffLineAnnotation<LAnnotation>
): annotation is LineAnnotation<LAnnotation> {
  return !isDiffAnnotation(annotation);
}

/**
 * Narrow a homogeneous editor annotation collection to diff annotations.
 * Empty collections return true because they are valid for either shape.
 */
export function isDiffAnnotationCollection<LAnnotation = undefined>(
  annotations: LineAnnotation<LAnnotation>[] | DiffLineAnnotation<LAnnotation>[]
): annotations is DiffLineAnnotation<LAnnotation>[] {
  const first = annotations[0];
  return first == null || isDiffAnnotation(first);
}

/**
 * Narrow a homogeneous editor annotation collection to file annotations.
 * Empty collections return true because they are valid for either shape.
 */
export function isFileAnnotationCollection<LAnnotation = undefined>(
  annotations: LineAnnotation<LAnnotation>[] | DiffLineAnnotation<LAnnotation>[]
): annotations is LineAnnotation<LAnnotation>[] {
  const first = annotations[0];
  return first == null || isFileAnnotation(first);
}
