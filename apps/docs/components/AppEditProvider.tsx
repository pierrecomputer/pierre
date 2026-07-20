'use client';

import { Editor, type EditorOptions } from '@pierre/diffs/editor';
import { EditProvider } from '@pierre/diffs/react';
import type { ReactNode } from 'react';

function createEditor<LAnnotation>(
  options: EditorOptions<LAnnotation>
): Editor<LAnnotation> {
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
