export const TOKEN_TRANSFORMER_DOCS_URL =
  'https://diffs.com/docs#edit-mode-performance-and-loading-worker-pool';

/**
 * Logs an error for a file or diff that enters edit mode from markup rendered
 * without the token transformer, which is required for editing. The highlight
 * cache and DOM cannot be re-used which can cause extra work when entering
 * edit mode. Production builds stay silent.
 */
export function reportEditWithoutTokenTransformer(fileName: string): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.error(
      `[diffs] "${fileName}" was rendered without \`useTokenTransformer\`, so ` +
        'its DOM cannot be reused in edit mode and the whole file is ' +
        're-highlighted and re-rendered. ' +
        'Set `useTokenTransformer: true` for files that can be edited. ' +
        `See ${TOKEN_TRANSFORMER_DOCS_URL}`
    );
  }
}
