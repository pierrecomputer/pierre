'use client';

import { Editor, type EditorOptions } from '@pierre/diffs/edit';
import { EditProvider } from '@pierre/diffs/react';
import type { ReactNode } from 'react';

function createEditor<LAnnotation, LDecoration>(
  options: EditorOptions<LAnnotation, LDecoration>
): Editor<LAnnotation, LDecoration> {
  return new Editor(options);
}

interface AppEditProviderProps {
  children: ReactNode;
}

export function AppEditProvider({
  children,
}: AppEditProviderProps): React.JSX.Element {
  return <EditProvider createEditor={createEditor}>{children}</EditProvider>;
}
