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
import {
  GIT_STATUSES_A,
  sharedDemoFileTreeOptions,
  sharedDemoStateConfig,
} from './demo-data';

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

  const mainSsr = preloadFileTree(fileTreeOptions, sharedDemoStateConfig);
  const controlledSsr = preloadFileTree(fileTreeOptions, {
    ...sharedDemoStateConfig,
    initialSelectedItems: ['Build/assets/images/social/logo.png'],
  });
  const gitStatusSsr = preloadFileTree(
    { ...fileTreeOptions, gitStatus: GIT_STATUSES_A },
    sharedDemoStateConfig
  );

  return (
    <ClientPage
      preloadedFileTreeHtml={mainSsr.shadowHtml}
      preloadedFileTreeContainerHtml={mainSsr.html}
      preloadedControlledFileTreeHtml={controlledSsr.shadowHtml}
      preloadedGitStatusFileTreeHtml={gitStatusSsr.shadowHtml}
      initialFlattenEmptyDirectories={flattenEmptyDirectories}
      initialUseLazyDataLoader={useLazyDataLoader}
    />
  );
}
