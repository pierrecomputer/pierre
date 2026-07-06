// oxlint-disable typescript/no-explicit-any
'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext, useEffect } from 'react';

import type { Editor } from '../editor';

export const EditorContext: Context<Editor<any> | undefined> = createContext<
  Editor<any> | undefined
>(undefined);

export function EditorProvider({
  children,
  editor,
}: PropsWithChildren<{ editor: Editor<any> }>): React.JSX.Element {
  useEffect(() => {
    return () => {
      editor.cleanUp();
    };
  }, [editor]);
  return (
    <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>
  );
}

export function useEditor<LAnnotation>(): Editor<LAnnotation> | undefined {
  return useContext(EditorContext);
}
