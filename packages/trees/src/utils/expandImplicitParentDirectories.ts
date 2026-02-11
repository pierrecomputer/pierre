import { FLATTENED_PREFIX } from '../constants';

/**
 * Expands "deep" paths into an explicit list that includes all ancestor
 * directories, e.g. ['a/b/c'] -> ['a', 'a/b', 'a/b/c'].
 *
 * Intended for initializing controlled `expandedItems` state.
 */
export function expandImplicitParentDirectories(paths: string[]): string[] {
  const out = new Set<string>();

  for (const raw of paths) {
    if (raw === '') continue;
    const path = raw.startsWith(FLATTENED_PREFIX)
      ? raw.slice(FLATTENED_PREFIX.length)
      : raw;
    if (path === '' || path === 'root') continue;

    const parts = path.split('/');
    let cur = '';
    for (const part of parts) {
      cur = cur === '' ? part : `${cur}/${part}`;
      out.add(cur);
    }
  }

  // Stable order: shallow before deep, then lexical.
  return Array.from(out).sort((a, b) => {
    const da = a.split('/').length;
    const db = b.split('/').length;
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });
}
