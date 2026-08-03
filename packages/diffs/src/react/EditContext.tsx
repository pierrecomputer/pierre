// oxlint-disable typescript/no-explicit-any
'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext } from 'react';

import type { EditorOptions } from '../edit';
import type { DiffsEditor } from '../types';
import { useStableCallback } from './utils/useStableCallback';

/** Creates an Editor. Components manage the instance lifecycle. */
export type CreateEditor<LAnnotation> = (
  options: EditorOptions<LAnnotation>
) => DiffsEditor<LAnnotation>;

export interface EditProviderProps<LAnnotation> {
  /**
   * Creates an editor for each editable surface. Combines shared defaults
   * with the supplied per-surface options. Ignored when `sharedEditor` is
   * provided.
   */
  createEditor?: CreateEditor<LAnnotation>;
  /**
   * One editor instance handed to every editable surface under this
   * provider, exactly as its owner configured it — the surfaces'
   * `editorOptions` props are ignored, so pass options to the editor's
   * constructor instead. Instance state — like persist-state records —
   * survives surface remounts. Only for UIs that edit one surface at a
   * time; simultaneously editable surfaces (e.g. several CodeView items in
   * edit mode) need per-surface editors from `createEditor`.
   */
  sharedEditor?: DiffsEditor<LAnnotation>;
}

export const EditContext: Context<CreateEditor<any> | undefined> =
  createContext<CreateEditor<any> | undefined>(undefined);

export function EditProvider<LAnnotation>({
  children,
  createEditor,
  sharedEditor,
}: PropsWithChildren<EditProviderProps<LAnnotation>>): React.JSX.Element {
  const stableCreateEditor = useStableCallback(
    (options: EditorOptions<LAnnotation>): DiffsEditor<LAnnotation> => {
      if (sharedEditor != null) {
        // options is ignored when sharedEditor is provided
        return sharedEditor;
      }
      if (createEditor == null) {
        throw new Error(
          'EditProvider: either `sharedEditor` or `createEditor` is required'
        );
      }
      return createEditor(options);
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
