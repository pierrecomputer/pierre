'use client';

import {
  Editor,
  type EditorDocumentKind,
  type EditorOptions,
} from '@pierre/diffs/edit';
import { EditProvider } from '@pierre/diffs/react';
import type { ReactNode } from 'react';

function createEditor<TDocumentKind extends EditorDocumentKind, LAnnotation>(
  documentKind: TDocumentKind,
  options: EditorOptions<TDocumentKind, LAnnotation>,
  editStateKey?: string
): Editor<TDocumentKind, LAnnotation> {
  return new Editor(documentKind, options, editStateKey);
}

interface AppEditProviderProps {
  children: ReactNode;
}

export function AppEditProvider({
  children,
}: AppEditProviderProps): React.JSX.Element {
  return <EditProvider createEditor={createEditor}>{children}</EditProvider>;
}
