'use client';

import type { FileTreeOptions } from '@pierre/trees';
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
  FILE_TREE_COOKIE_LAZY,
  FILE_TREE_COOKIE_VERSION,
  FILE_TREE_COOKIE_VERSION_NAME,
} from '../cookies';
import { sharedDemoFileTreeOptions } from '../demo-data';

interface TreesDevSettingsContextValue {
  flattenEmptyDirectories: boolean;
  useLazyDataLoader: boolean;
  setFlattenEmptyDirectories: (val: boolean) => void;
  setUseLazyDataLoader: (val: boolean) => void;
  handleResetControls: () => void;
  fileTreeOptions: FileTreeOptions;
  reactOptions: Omit<FileTreeOptions, 'initialFiles'>;
  reactFiles: string[] | undefined;
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
  initialUseLazyDataLoader,
  children,
}: {
  initialFlattenEmptyDirectories: boolean;
  initialUseLazyDataLoader: boolean;
  children: ReactNode;
}) {
  const defaultFlattenEmptyDirectories =
    sharedDemoFileTreeOptions.flattenEmptyDirectories ?? false;
  const defaultUseLazyDataLoader =
    sharedDemoFileTreeOptions.useLazyDataLoader ?? false;
  const [flattenEmptyDirectories, setFlattenEmptyDirectoriesState] = useState(
    initialFlattenEmptyDirectories
  );
  const [useLazyDataLoader, setUseLazyDataLoaderState] = useState(
    initialUseLazyDataLoader
  );
  const skipCookieWriteRef = useRef(false);

  const setFlattenEmptyDirectories = (val: boolean) => {
    startTransition(() => setFlattenEmptyDirectoriesState(val));
  };
  const setUseLazyDataLoader = (val: boolean) => {
    startTransition(() => setUseLazyDataLoaderState(val));
  };

  const handleResetControls = () => {
    skipCookieWriteRef.current = true;
    const clearCookie = (name: string) => {
      document.cookie = `${name}=; path=/; max-age=0`;
    };
    clearCookie(FILE_TREE_COOKIE_VERSION_NAME);
    clearCookie(FILE_TREE_COOKIE_FLATTEN);
    clearCookie(FILE_TREE_COOKIE_LAZY);
    startTransition(() => {
      setFlattenEmptyDirectoriesState(defaultFlattenEmptyDirectories);
      setUseLazyDataLoaderState(defaultUseLazyDataLoader);
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
    document.cookie = `${FILE_TREE_COOKIE_LAZY}=${
      useLazyDataLoader ? '1' : '0'
    }${cookieSuffix}`;
  }, [cookieMaxAge, flattenEmptyDirectories, useLazyDataLoader]);

  const fileTreeOptions = useMemo<FileTreeOptions>(
    () => ({
      ...sharedDemoFileTreeOptions,
      flattenEmptyDirectories,
      useLazyDataLoader,
    }),
    [flattenEmptyDirectories, useLazyDataLoader]
  );

  const { initialFiles: reactFiles, ...reactOptions } = fileTreeOptions;

  const value = useMemo<TreesDevSettingsContextValue>(
    () => ({
      flattenEmptyDirectories,
      useLazyDataLoader,
      setFlattenEmptyDirectories,
      setUseLazyDataLoader,
      handleResetControls,
      fileTreeOptions,
      reactOptions,
      reactFiles,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flattenEmptyDirectories, useLazyDataLoader, fileTreeOptions]
  );

  return (
    <TreesDevSettingsContext.Provider value={value}>
      {children}
    </TreesDevSettingsContext.Provider>
  );
}
