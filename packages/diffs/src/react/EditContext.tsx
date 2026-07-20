// oxlint-disable typescript/no-explicit-any
'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext } from 'react';

import type { EditorOptions } from '../editor';
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
  const stableCreateEditor = useStableCallback(createEditor);
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
