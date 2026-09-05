// oxlint-disable typescript/no-explicit-any
'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext } from 'react';

import type { Editor, EditorFactory, EditorOptions, EditorType } from '../edit';
import { useStableCallback } from './utils/useStableCallback';

export type { EditorFactory } from '../edit';

export interface EditProviderProps<LAnnotation, Caret> {
  /** Combines shared defaults with the supplied per-surface options. */
  createEditor: EditorFactory<LAnnotation, Caret>;
}

export const EditContext: Context<EditorFactory<any, any> | undefined> =
  createContext<EditorFactory<any, any> | undefined>(undefined);

export function EditProvider<LAnnotation = undefined, Caret = undefined>({
  children,
  createEditor,
}: PropsWithChildren<
  EditProviderProps<LAnnotation, Caret>
>): React.JSX.Element {
  const stableCreateEditor = useStableCallback(
    <EType extends EditorType>(
      editorType: EType,
      options: EditorOptions<EType, LAnnotation, Caret>,
      editStateKey?: string
    ): Editor<EType, LAnnotation, Caret> =>
      createEditor(editorType, options, editStateKey)
  );
  return (
    <EditContext.Provider value={stableCreateEditor}>
      {children}
    </EditContext.Provider>
  );
}

export function useCreateEditor<LAnnotation, Caret>():
  | EditorFactory<LAnnotation, Caret>
  | undefined {
  return useContext(EditContext);
}
