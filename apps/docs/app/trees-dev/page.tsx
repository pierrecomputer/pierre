import { preloadFileTree } from '@pierre/trees/ssr';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { ClientPage } from './ClientPage';
import {
  FILE_TREE_COOKIE_FLATTEN,
  FILE_TREE_COOKIE_LAZY,
  FILE_TREE_COOKIE_VERSION,
  FILE_TREE_COOKIE_VERSION_NAME,
} from './cookies';
import { sharedDemoFileTreeOptions, sharedDemoStateConfig } from './demo-data';

export default async function FileTreePage() {
  if (process.env.NODE_ENV !== 'development') {
    return notFound();
  }
  const cookieStore = await cookies();
  const cookieVersion = cookieStore.get(FILE_TREE_COOKIE_VERSION_NAME)?.value;
  const hasValidCookieVersion = cookieVersion === FILE_TREE_COOKIE_VERSION;
  const flattenCookie = hasValidCookieVersion
    ? cookieStore.get(FILE_TREE_COOKIE_FLATTEN)?.value
    : undefined;
  const lazyCookie = hasValidCookieVersion
    ? cookieStore.get(FILE_TREE_COOKIE_LAZY)?.value
    : undefined;
  const flattenEmptyDirectories =
    flattenCookie != null
      ? flattenCookie === '1'
      : (sharedDemoFileTreeOptions.flattenEmptyDirectories ?? false);
  const useLazyDataLoader =
    lazyCookie != null
      ? lazyCookie === '1'
      : (sharedDemoFileTreeOptions.useLazyDataLoader ?? false);

  const fileTreeOptions = {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories,
    useLazyDataLoader,
  };

  return (
    <ClientPage
      preloadedFileTreeHtml={preloadFileTree(
        fileTreeOptions,
        sharedDemoStateConfig
      )}
      initialFlattenEmptyDirectories={flattenEmptyDirectories}
      initialUseLazyDataLoader={useLazyDataLoader}
    />
  );
}
