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
  /**
   * Creates an editor for each editable surface. Combines shared defaults
   * with the supplied per-surface options. Created editors are cached by
   * options-object identity: an edit session restarting with the same
   * `editorOptions` object reuses its editor (pass a new object to start
   * fresh), and surfaces that are editable at the same time must receive
   * distinct options objects. Ignored when `sharedEditor` is provided.
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
  // Editors cached by options-object identity: an edit session that restarts
  // with the same `editorOptions` (StrictMode's double effect pass, an
  // edit-mode toggle, a surface remount) reuses its editor instead of
  // creating a new one — which also lets the editor's `persistState` caches
  // survive between sessions. A new options object still creates a fresh
  // editor, and the WeakMap drops each entry with its options object.
  const editorCache = useRef(
    new WeakMap<EditorOptions<LAnnotation>, DiffsEditor<LAnnotation>>()
  );
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
      const cached = editorCache.current.get(options);
      if (cached != null) {
        return cached;
      }
      const editor = createEditor(options);
      editorCache.current.set(options, editor);
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
