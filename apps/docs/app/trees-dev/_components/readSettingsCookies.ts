import { cookies } from 'next/headers';

import {
  FILE_TREE_COOKIE_FLATTEN,
  FILE_TREE_COOKIE_LAZY,
  FILE_TREE_COOKIE_VERSION,
  FILE_TREE_COOKIE_VERSION_NAME,
} from '../cookies';
import { sharedDemoFileTreeOptions } from '../demo-data';

/**
 * Reads flatten/lazy settings from cookies on the server.
 * Shared by the layout and individual demo pages that need SSR preloading.
 */
export async function readSettingsCookies(): Promise<{
  flattenEmptyDirectories: boolean;
  useLazyDataLoader: boolean;
}> {
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

  return { flattenEmptyDirectories, useLazyDataLoader };
}
