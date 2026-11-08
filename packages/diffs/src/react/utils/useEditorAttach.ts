import { useMemo, useRef, useState } from 'react';

import type { File } from '../../components/File';
import type { FileDiff } from '../../components/FileDiff';

type EditableInstance<LAnnotation, Caret> =
  | File<LAnnotation, Caret>
  | FileDiff<LAnnotation, Caret>;

interface PendingAttach {
  promise: Promise<void>;
}

// The attach state, kept in a ref for the component's lifetime.
interface AttachState {
  disposeEditor: (() => void) | null;
  pendingAttach: PendingAttach | null;
}

export interface EditorAttach<LAnnotation, Caret> {
  // Attaches the editor to `instance` once it can start a session: at once
  // when it can, otherwise after its `__prepareForEditing()` promise resolves.
  // `applyEdit` performs the attach and returns the editor's dispose function;
  // `onAttached` runs right after a successful attach.
  attachWhenReady(
    instance: EditableInstance<LAnnotation, Caret>,
    applyEdit: () => () => void,
    onAttached: () => void
  ): void;
  // Detaches the editor when editing turns off.
  detach(): void;
  // Forgets the editor after the instance was cleaned up, which already tore
  // the editor down.
  forget(): void;
  isAttached(): boolean;
}

/**
 * Keeps an editor attached to a File or FileDiff instance for the React
 * hooks. The hooks call `attachWhenReady` from their render effect, which
 * runs again after the instance re-renders itself, so a wait that ends with
 * the instance still not ready is retried on that render. An error from the
 * wait is thrown on the next render.
 */
export function useEditorAttach<LAnnotation, Caret>(): EditorAttach<
  LAnnotation,
  Caret
> {
  const [asyncAttachError, setAsyncAttachError] = useState<unknown>();
  if (asyncAttachError != null) {
    throw asyncAttachError;
  }
  const state = useRef<AttachState>({
    disposeEditor: null,
    pendingAttach: null,
  });
  return useMemo(() => {
    const { current } = state;
    return {
      isAttached: () => current.disposeEditor != null,
      detach() {
        current.pendingAttach = null;
        const { disposeEditor } = current;
        if (disposeEditor != null) {
          current.disposeEditor = null;
          disposeEditor();
        }
      },
      forget() {
        current.pendingAttach = null;
        current.disposeEditor = null;
      },
      attachWhenReady(instance, applyEdit, onAttached) {
        if (current.disposeEditor != null) {
          return;
        }
        const attach = (): void => {
          if (current.disposeEditor != null || !instance.isReadyToEdit()) {
            return;
          }
          current.disposeEditor = applyEdit();
          onAttached();
        };
        if (instance.isReadyToEdit()) {
          current.pendingAttach = null;
          attach();
          return;
        }
        const promise = instance.__prepareForEditing();
        // Nothing to wait on means nothing can be done for this input.
        if (promise == null) {
          current.pendingAttach = null;
          return;
        }
        // Already waiting on this same preparation.
        if (current.pendingAttach?.promise === promise) {
          return;
        }
        const pending: PendingAttach = { promise };
        current.pendingAttach = pending;
        void promise
          .then(() => {
            if (current.pendingAttach !== pending) {
              return;
            }
            // Cleared after attaching, so an attach that throws is still
            // this wait's error below.
            attach();
            current.pendingAttach = null;
          })
          .catch((error: unknown) => {
            if (current.pendingAttach === pending) {
              current.pendingAttach = null;
              setAsyncAttachError(error);
            }
          });
      },
    };
  }, []);
}
