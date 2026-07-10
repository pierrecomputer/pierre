// oxlint-disable typescript/no-explicit-any
'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext, useEffect } from 'react';

import type { Editor } from '../editor';

export const EditContext: Context<Editor<any> | undefined> = createContext<
  Editor<any> | undefined
>(undefined);

export function EditProvider({
  children,
  editor,
}: PropsWithChildren<{ editor: Editor<any> }>): React.JSX.Element {
  useEffect(() => {
    return () => {
      editor.cleanUp();
    };
  }, [editor]);
  return <EditContext.Provider value={editor}>{children}</EditContext.Provider>;
}

export function useEditor<LAnnotation>(): Editor<LAnnotation> | undefined {
  return useContext(EditContext);
}
