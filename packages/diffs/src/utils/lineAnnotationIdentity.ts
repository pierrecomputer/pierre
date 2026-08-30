import type { AnnotationSide } from '../types';

export interface LineAnnotationPosition {
  lineNumber: number;
  side?: AnnotationSide;
}

// When an edit moves an annotation to another line, the remap replaces it
// with a shallow clone holding the new line number, and later edits clone
// those clones again. This map links every clone back to the original
// annotation the caller passed in, so session state keyed by that original —
// most importantly recorded slot names — keeps working no matter how many
// times an annotation has been cloned, or which clone generation an undo
// brings back.
const lineAnnotationSources = new WeakMap<
  LineAnnotationPosition,
  LineAnnotationPosition
>();

/**
 * Resolve a possibly-remapped annotation back to the original object it
 * descends from. Annotations that were never cloned resolve to themselves.
 */
export function getLineAnnotationSource<T extends LineAnnotationPosition>(
  annotation: T
): T {
  const source = lineAnnotationSources.get(annotation);
  return source == null ? annotation : (source as T);
}

export function recordLineAnnotationSource(
  moved: LineAnnotationPosition,
  annotation: LineAnnotationPosition
): void {
  lineAnnotationSources.set(moved, annotation);
}
