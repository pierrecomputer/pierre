import type { FileDiff } from '../src/components/FileDiff';
import { Editor } from '../src/editor/editor';
import { TextDocument } from '../src/editor/textDocument';
import type {
  ApplyChangeResult,
  EditorType,
  TextEdit,
} from '../src/editor/types';
import type { HighlightedToken } from '../src/types';

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

// An edit that gives one line new text, keeping its line break.
export function lineEdit<EType extends EditorType, LAnnotation>(
  document: TextDocument<EType, LAnnotation>,
  line: number,
  text: string
): TextEdit {
  const current = document.getLineText(line, false);
  return {
    range: {
      start: { line, character: 0 },
      end: { line, character: current.length },
    },
    newText: text,
  };
}

// An edit that replaces the whole document with these lines, which include
// their line endings.
export function documentEdit<EType extends EditorType, LAnnotation>(
  document: TextDocument<EType, LAnnotation>,
  lines: readonly string[]
): TextEdit {
  const last = document.lineCount - 1;
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: last, character: document.getLineText(last, false).length },
    },
    newText: lines.join(''),
  };
}

// Applies edits to the editor's document and hands the change to the diff
// the way the editor does, with plain tokens for the lines the change touched.
export function applySessionEdits<LAnnotation>(
  instance: FileDiff<LAnnotation>,
  document: TextDocument<'file-diff', LAnnotation>,
  edits: TextEdit[]
): ApplyChangeResult {
  const change = document.applyEdits(edits);
  if (change == null) {
    throw new Error('applySessionEdits: the edits changed nothing');
  }
  const tokens = new Map<number, HighlightedToken[]>();
  const last = Math.min(change.endLine, document.lineCount - 1);
  for (let line = change.startLine; line <= last; line++) {
    tokens.set(line, [[0, '', document.getLineText(line, false)]]);
  }
  return instance.applyChange(document, change, { tokens });
}
