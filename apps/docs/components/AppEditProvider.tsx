'use client';

import {
  Editor,
  type EditorOptions,
  type EditorType,
} from '@pierre/diffs/edit';
import { EditProvider } from '@pierre/diffs/react';
import type { ReactNode } from 'react';

function createEditor<EType extends EditorType, LAnnotation>(
  editorType: EType,
  options: EditorOptions<EType, LAnnotation>,
  editStateKey?: string
): Editor<EType, LAnnotation> {
  return new Editor(editorType, options, editStateKey);
}

interface AppEditProviderProps {
  children: ReactNode;
}

export function AppEditProvider({
  children,
}: AppEditProviderProps): React.JSX.Element {
  return <EditProvider createEditor={createEditor}>{children}</EditProvider>;
}
