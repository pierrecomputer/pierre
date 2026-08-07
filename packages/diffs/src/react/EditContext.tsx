// oxlint-disable typescript/no-explicit-any
'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext, useRef } from 'react';

import type { EditorOptions } from '../edit';
import type { DiffsEditor } from '../types';
import { useStableCallback } from './utils/useStableCallback';

/** Creates an Editor. Components manage the instance lifecycle. */
export type CreateEditor<LAnnotation> = (
  options: EditorOptions<LAnnotation>
) => DiffsEditor<LAnnotation>;

export interface EditProviderProps<LAnnotation> {
  /** Combines shared defaults with the supplied per-surface options. */
  createEditor: CreateEditor<LAnnotation>;
}

export const EditContext: Context<CreateEditor<any> | undefined> =
  createContext<CreateEditor<any> | undefined>(undefined);

export function EditProvider<LAnnotation>({
  children,
  createEditor,
}: PropsWithChildren<EditProviderProps<LAnnotation>>): React.JSX.Element {
  // Editors cached by options-object identity: an edit session that restarts
  // with the same `editorOptions`
  const editorCacheRef = useRef(
    new WeakMap<EditorOptions<LAnnotation>, DiffsEditor<LAnnotation>>()
  );
  const stableCreateEditor = useStableCallback(
    (options: EditorOptions<LAnnotation>): DiffsEditor<LAnnotation> => {
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

export function useCreateEditor<LAnnotation>():
  | CreateEditor<LAnnotation>
  | undefined {
  return useContext(EditContext);
}
