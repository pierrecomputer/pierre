import { expect, test } from 'bun:test';

import type { FileEditCompleteHandler } from '../src/components/File';
import type { FileDiffEditCompleteHandler } from '../src/components/FileDiff';
import type { EditorOptions } from '../src/editor/editor';
import type { DiffsEditor } from '../src/types';

interface AnnotationMetadata {
  id: string;
}

test('editor events preserve annotation types', () => {
  const onChange: NonNullable<EditorOptions<AnnotationMetadata>['onChange']> = (
    event
  ) => {
    const editor: DiffsEditor<AnnotationMetadata> = event.editor;
    const metadata: AnnotationMetadata | undefined =
      event.lineAnnotations?.[0]?.metadata ??
      editor.getEditState()?.document.history.undoStack[0]
        ?.lineAnnotationsBefore?.[0]?.metadata;
    void metadata;
  };
  const onFileComplete: FileEditCompleteHandler<AnnotationMetadata> = (
    event
  ) => {
    const editor: DiffsEditor<AnnotationMetadata> = event.editor;
    const metadata: AnnotationMetadata | undefined =
      event.lineAnnotations?.[0]?.metadata;
    void editor;
    void metadata;
    return 'reject';
  };
  const onFileDiffComplete: FileDiffEditCompleteHandler<AnnotationMetadata> = (
    event
  ) => {
    const editor: DiffsEditor<AnnotationMetadata> = event.editor;
    const metadata: AnnotationMetadata | undefined =
      event.lineAnnotations?.[0]?.metadata;
    void editor;
    void metadata;
    return 'reject';
  };

  expect(onChange).toBeFunction();
  expect(onFileComplete).toBeFunction();
  expect(onFileDiffComplete).toBeFunction();
});
