import { Editor } from '../src/editor/editor';
import { TextDocument } from '../src/editor/textDocument';
import type { EditorDocumentKind } from '../src/editor/types';

// Creates the real editor class used by component attachment tests while
// allowing individual tests to instrument a public method when needed.
export function createEditorInstance<
  TDocumentKind extends EditorDocumentKind,
  LAnnotation = undefined,
>(
  documentKind: TDocumentKind,
  overrides: Partial<Editor<TDocumentKind, LAnnotation>> = {}
): Editor<TDocumentKind, LAnnotation> {
  return Object.assign(
    new Editor<TDocumentKind, LAnnotation>(documentKind),
    overrides
  );
}

// Creates a typed editor document from line strings that already include their
// line endings, matching the data passed through component edit sessions.
export function createTextDocumentFromLines<
  TDocumentKind extends EditorDocumentKind,
  LAnnotation = undefined,
>(
  documentKind: TDocumentKind,
  lines: readonly string[],
  uri: string = `inmemory://${documentKind}`
): TextDocument<TDocumentKind, LAnnotation> {
  return new TextDocument<TDocumentKind, LAnnotation>(uri, lines.join(''));
}
