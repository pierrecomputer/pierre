import { useRef } from 'react';

import { Editor, type EditorOptions } from '../../editor';
import { areObjectsEqual } from '../../utils/areObjectsEqual';

export function useStableEditor<LAnnotation>(
  options?: EditorOptions<LAnnotation>
): Editor<LAnnotation> {
  const editorRef = useRef<Editor<LAnnotation> | undefined>(undefined);
  const optionsRef = useRef<EditorOptions<LAnnotation> | undefined>(undefined);

  if (editorRef.current == null) {
    editorRef.current = new Editor(options);
    optionsRef.current = options;
  } else if (!areObjectsEqual(optionsRef.current, options)) {
    editorRef.current.setOptions(options ?? {});
    optionsRef.current = options;
  }

  return editorRef.current;
}
