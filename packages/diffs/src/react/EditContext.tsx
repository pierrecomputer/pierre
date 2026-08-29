// oxlint-disable typescript/no-explicit-any
'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext } from 'react';

import type { Editor, EditorDocumentKind, EditorOptions } from '../edit';
import { useStableCallback } from './utils/useStableCallback';

/** Creates an Editor. Components manage the instance lifecycle. */
export type CreateEditor<LAnnotation, LCaret = undefined> = <
  TDocumentKind extends EditorDocumentKind,
>(
  documentKind: TDocumentKind,
  options: EditorOptions<TDocumentKind, LAnnotation, LCaret>,
  editStateKey?: string
) => Editor<TDocumentKind, LAnnotation, LCaret>;

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
    <TDocumentKind extends EditorDocumentKind>(
      documentKind: TDocumentKind,
      options: EditorOptions<TDocumentKind, LAnnotation, LCaret>,
      editStateKey?: string
    ): Editor<TDocumentKind, LAnnotation, LCaret> =>
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
