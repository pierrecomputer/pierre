// oxlint-disable typescript/no-explicit-any
'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext } from 'react';

import type { EditorDocumentKind, EditorOptions } from '../edit';
import type { DiffsEditor } from '../types';
import { useStableCallback } from './utils/useStableCallback';

/** Creates an Editor. Components manage the instance lifecycle. */
export type CreateEditor<LAnnotation, LCaret = undefined> = (
  documentKind: EditorDocumentKind,
  options: EditorOptions<LAnnotation, LCaret>,
  editStateKey?: string
) => DiffsEditor<LAnnotation>;

export interface EditProviderProps<LAnnotation, LCaret = undefined> {
  /** Combines shared defaults with the supplied per-surface options. */
  createEditor: CreateEditor<LAnnotation, LCaret>;
}

export const EditContext: Context<CreateEditor<any, any> | undefined> =
  createContext<CreateEditor<any, any> | undefined>(undefined);

export function EditProvider<LAnnotation, LCaret = undefined>({
  children,
  createEditor,
}: PropsWithChildren<
  EditProviderProps<LAnnotation, LCaret>
>): React.JSX.Element {
  const stableCreateEditor = useStableCallback(
    (
      documentKind: EditorDocumentKind,
      options: EditorOptions<LAnnotation, LCaret>,
      editStateKey?: string
    ): DiffsEditor<LAnnotation> =>
      createEditor(documentKind, options, editStateKey)
  );
  return (
    <EditContext.Provider value={stableCreateEditor}>
      {children}
    </EditContext.Provider>
  );
}

export function useCreateEditor<LAnnotation, LCaret = undefined>():
  | CreateEditor<LAnnotation, LCaret>
  | undefined {
  return useContext(EditContext);
}
