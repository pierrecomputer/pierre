import { Editor } from '../src/editor/editor';
import { TextDocument } from '../src/editor/textDocument';
import type { EditorType } from '../src/editor/types';

// Creates the real editor class used by component attachment tests while
// allowing individual tests to instrument a public method when needed.
export function createEditorInstance<
  EType extends EditorType,
  LAnnotation = undefined,
>(
  editorType: EType,
  overrides: Partial<Editor<EType, LAnnotation>> = {}
): Editor<EType, LAnnotation> {
  return Object.assign(new Editor<EType, LAnnotation>(editorType), overrides);
}

// Creates a typed editor document from line strings that already include their
// line endings, matching the data passed through component edit sessions.
export function createTextDocumentFromLines<
  EType extends EditorType,
  LAnnotation = undefined,
>(
  editorType: EType,
  lines: readonly string[],
  uri: string = `inmemory://${editorType}`
): TextDocument<EType, LAnnotation> {
  return new TextDocument<EType, LAnnotation>(uri, lines.join(''));
}
