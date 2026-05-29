import type { DiffLineAnnotation } from '../types';
import type { TextDocumentChange } from './textDocument';

export function applyDocumentChangeToLineAnnotations<T>(
  change: TextDocumentChange,
  lineAnnotations: DiffLineAnnotation<T>[]
): DiffLineAnnotation<T>[] | undefined {
  if (change.lineDelta === 0) {
    return undefined;
  }

  const startCharacter = change.startCharacter;
  const removedLineCount = Math.max(0, -change.lineDelta);
  const deletedStartLine =
    removedLineCount === 0
      ? undefined
      : change.startLine + (startCharacter === 0 ? 0 : 1);
  const deletedEndLine =
    deletedStartLine === undefined
      ? undefined
      : deletedStartLine + removedLineCount;
  const shiftFromLine =
    removedLineCount > 0
      ? change.startLine + removedLineCount
      : change.startLine + (startCharacter === 0 ? 0 : 1);
  const nextLineAnnotations: DiffLineAnnotation<T>[] = [];

  let changed = false;
  for (const annotation of lineAnnotations) {
    const line = annotation.lineNumber - 1;
    if (
      deletedStartLine !== undefined &&
      deletedEndLine !== undefined &&
      line >= deletedStartLine &&
      line < deletedEndLine
    ) {
      changed = true;
      continue;
    }

    if (line >= shiftFromLine) {
      nextLineAnnotations.push({
        ...annotation,
        lineNumber: line + change.lineDelta + 1,
      });
      changed = true;
      continue;
    }

    nextLineAnnotations.push(annotation);
  }

  return changed ? nextLineAnnotations : undefined;
}
