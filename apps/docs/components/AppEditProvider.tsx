'use client';

import {
  Editor,
  type EditorDocumentKind,
  type EditorOptions,
} from '@pierre/diffs/edit';
import { EditProvider } from '@pierre/diffs/react';
import type { ReactNode } from 'react';

function createEditor<LAnnotation>(
  documentKind: EditorDocumentKind,
  options: EditorOptions<LAnnotation>,
  editHistoryKey?: string
): Editor<LAnnotation> {
  return new Editor(documentKind, options, editHistoryKey);
}

interface AppEditProviderProps {
  children: ReactNode;
}

export function AppEditProvider({
  children,
}: AppEditProviderProps): React.JSX.Element {
  return <EditProvider createEditor={createEditor}>{children}</EditProvider>;
}
