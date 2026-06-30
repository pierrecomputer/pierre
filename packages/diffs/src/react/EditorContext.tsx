'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext, useEffect } from 'react';

import type { Editor } from '../editor';

export const EditorContext: Context<Editor<unknown> | undefined> =
  createContext<Editor<unknown> | undefined>(undefined);

export function EditorProvider({
  children,
  editor,
}: PropsWithChildren<{ editor: Editor<unknown> }>): React.JSX.Element {
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
  return useContext(EditorContext) as Editor<LAnnotation> | undefined;
}
