// oxlint-disable typescript/no-explicit-any
'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext, useRef } from 'react';

import type { EditorOptions } from '../edit';
import type { DiffsEditor } from '../types';
import { useStableCallback } from './utils/useStableCallback';

/** Creates an Editor. Components manage the instance lifecycle. */
export type CreateEditor<LAnnotation, LDecoration = undefined> = (
  options: EditorOptions<LAnnotation, LDecoration>
) => DiffsEditor<LAnnotation>;

export interface EditProviderProps<LAnnotation, LDecoration = undefined> {
  /** Combines shared defaults with the supplied per-surface options. */
  createEditor: CreateEditor<LAnnotation, LDecoration>;
}

export const EditContext: Context<CreateEditor<any, any> | undefined> =
  createContext<CreateEditor<any, any> | undefined>(undefined);

export function EditProvider<LAnnotation, LDecoration = undefined>({
  children,
  createEditor,
}: PropsWithChildren<
  EditProviderProps<LAnnotation, LDecoration>
>): React.JSX.Element {
  // Editors cached by options-object identity: an edit session that restarts
  // with the same `editorOptions`
  const editorCacheRef = useRef(
    new WeakMap<
      EditorOptions<LAnnotation, LDecoration>,
      DiffsEditor<LAnnotation>
    >()
  );
  const stableCreateEditor = useStableCallback(
    (
      options: EditorOptions<LAnnotation, LDecoration>
    ): DiffsEditor<LAnnotation> => {
      const cached = editorCacheRef.current.get(options);
      if (cached != null) {
        return cached;
      }
      const editor = createEditor(options);
      editorCacheRef.current.set(options, editor);
      return editor;
    }
  );
  return (
    <EditContext.Provider value={stableCreateEditor}>
      {children}
    </EditContext.Provider>
  );
}

export function useCreateEditor<LAnnotation, LDecoration = undefined>():
  | CreateEditor<LAnnotation, LDecoration>
  | undefined {
  return useContext(EditContext);
}
