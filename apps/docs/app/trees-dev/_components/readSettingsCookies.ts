import { cookies } from 'next/headers';

import {
  FILE_TREE_COOKIE_FLATTEN,
  FILE_TREE_COOKIE_VERSION,
  FILE_TREE_COOKIE_VERSION_NAME,
} from '../cookies';
import { sharedDemoFileTreeOptions } from '../demo-data';

/**
 * Reads the trees-dev settings that still affect the canonical demos.
 */
export async function readSettingsCookies(): Promise<{
  flattenEmptyDirectories: boolean;
}> {
  const cookieStore = await cookies();
  const cookieVersion = cookieStore.get(FILE_TREE_COOKIE_VERSION_NAME)?.value;
  const hasValidCookieVersion = cookieVersion === FILE_TREE_COOKIE_VERSION;
  const flattenCookie = hasValidCookieVersion
    ? cookieStore.get(FILE_TREE_COOKIE_FLATTEN)?.value
    : undefined;
  const flattenEmptyDirectories =
    flattenCookie != null
      ? flattenCookie === '1'
      : (sharedDemoFileTreeOptions.flattenEmptyDirectories ?? false);

  return { flattenEmptyDirectories };
}
