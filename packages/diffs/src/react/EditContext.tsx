// oxlint-disable typescript/no-explicit-any
'use client';

import type { Context, PropsWithChildren } from 'react';
import { createContext, useContext, useEffect } from 'react';

import type { Edit } from '../edit';

export const EditContext: Context<Edit<any> | undefined> = createContext<
  Edit<any> | undefined
>(undefined);

export function EditProvider({
  children,
  edit,
}: PropsWithChildren<{ edit: Edit<any> }>): React.JSX.Element {
  useEffect(() => {
    return () => {
      edit.cleanUp();
    };
  }, [edit]);
  return <EditContext.Provider value={edit}>{children}</EditContext.Provider>;
}

export function useEdit<LAnnotation>(): Edit<LAnnotation> | undefined {
  return useContext(EditContext);
}
