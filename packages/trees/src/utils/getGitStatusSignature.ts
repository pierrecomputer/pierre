import type { GitStatusEntry } from '../types';

/**
 * Produces a stable cache key for a git status array.
 */
export const getGitStatusSignature = (
  entries: GitStatusEntry[] | undefined
): string => {
  if (entries == null || entries.length === 0) {
    return '0';
  }

  let signature = `${entries.length}`;
  for (const entry of entries) {
    signature += `\0${entry.path}\0${entry.status}`;
  }
  return signature;
};
