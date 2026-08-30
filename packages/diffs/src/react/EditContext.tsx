// oxlint-disable typescript/no-explicit-any
'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext } from 'react';

import type { Editor, EditorFactory, EditorOptions, EditorType } from '../edit';
import { useStableCallback } from './utils/useStableCallback';

export type { EditorFactory } from '../edit';

export interface EditProviderProps<LAnnotation, LCaret = undefined> {
  /** Combines shared defaults with the supplied per-surface options. */
  createEditor: EditorFactory<LAnnotation, LCaret>;
}

export const EditContext: Context<EditorFactory<any, any> | undefined> =
  createContext<EditorFactory<any, any> | undefined>(undefined);

export function EditProvider<LAnnotation, LCaret = undefined>({
  children,
  createEditor,
}: PropsWithChildren<
  EditProviderProps<LAnnotation, LCaret>
>): React.JSX.Element {
  const stableCreateEditor = useStableCallback(
    <EType extends EditorType>(
      editorType: EType,
      options: EditorOptions<EType, LAnnotation, LCaret>,
      editStateKey?: string
    ): Editor<EType, LAnnotation, LCaret> =>
      createEditor(editorType, options, editStateKey)
  );
  return (
    <EditContext.Provider value={stableCreateEditor}>
      {children}
    </EditContext.Provider>
  );
}

export function useCreateEditor<LAnnotation, LCaret = undefined>():
  | EditorFactory<LAnnotation, LCaret>
  | undefined {
  return useContext(EditContext);
}
