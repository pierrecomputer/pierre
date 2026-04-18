'use client';

import {
  createContext,
  type ReactNode,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  FILE_TREE_COOKIE_FLATTEN,
  FILE_TREE_COOKIE_VERSION,
  FILE_TREE_COOKIE_VERSION_NAME,
} from '../cookies';
import { sharedDemoFileTreeOptions } from '../demo-data';

interface TreesDevSettingsContextValue {
  flattenEmptyDirectories: boolean;
  setFlattenEmptyDirectories: (val: boolean) => void;
  handleResetControls: () => void;
}

const TreesDevSettingsContext =
  createContext<TreesDevSettingsContextValue | null>(null);

export function useTreesDevSettings(): TreesDevSettingsContextValue {
  const ctx = useContext(TreesDevSettingsContext);
  if (ctx == null) {
    throw new Error(
      'useTreesDevSettings must be used within TreesDevSettingsProvider'
    );
  }
  return ctx;
}

export function TreesDevSettingsProvider({
  initialFlattenEmptyDirectories,
  children,
}: {
  initialFlattenEmptyDirectories: boolean;
  children: ReactNode;
}) {
  const defaultFlattenEmptyDirectories =
    sharedDemoFileTreeOptions.flattenEmptyDirectories ?? false;
  const [flattenEmptyDirectories, setFlattenEmptyDirectoriesState] = useState(
    initialFlattenEmptyDirectories
  );
  const skipCookieWriteRef = useRef(false);

  const setFlattenEmptyDirectories = (val: boolean) => {
    startTransition(() => setFlattenEmptyDirectoriesState(val));
  };

  const handleResetControls = () => {
    skipCookieWriteRef.current = true;
    document.cookie = `${FILE_TREE_COOKIE_VERSION_NAME}=; path=/; max-age=0`;
    document.cookie = `${FILE_TREE_COOKIE_FLATTEN}=; path=/; max-age=0`;
    startTransition(() => {
      setFlattenEmptyDirectoriesState(defaultFlattenEmptyDirectories);
    });
  };

  const cookieMaxAge = 60 * 60 * 24 * 365;
  useEffect(() => {
    if (skipCookieWriteRef.current) {
      skipCookieWriteRef.current = false;
      return;
    }
    const cookieSuffix = `; path=/; max-age=${cookieMaxAge}`;
    document.cookie = `${FILE_TREE_COOKIE_VERSION_NAME}=${FILE_TREE_COOKIE_VERSION}${cookieSuffix}`;
    document.cookie = `${FILE_TREE_COOKIE_FLATTEN}=${
      flattenEmptyDirectories ? '1' : '0'
    }${cookieSuffix}`;
  }, [cookieMaxAge, flattenEmptyDirectories]);

  const value = useMemo<TreesDevSettingsContextValue>(
    () => ({
      flattenEmptyDirectories,
      setFlattenEmptyDirectories,
      handleResetControls,
    }),
    [flattenEmptyDirectories]
  );

  return (
    <TreesDevSettingsContext.Provider value={value}>
      {children}
    </TreesDevSettingsContext.Provider>
  );
}
