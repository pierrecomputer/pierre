import type { FileTreeTranslationKey, GitStatus } from '../publicTypes';

export const GIT_STATUS_LABEL: Record<GitStatus, string | null> = {
  added: 'A',
  deleted: 'D',
  ignored: null,
  modified: 'M',
  renamed: 'R',
  untracked: 'U',
};

// Ignored rows render without a badge, so they have no tooltip either.
export const GIT_STATUS_TITLE_KEY: Record<
  GitStatus,
  FileTreeTranslationKey | null
> = {
  added: 'gitStatusAdded',
  deleted: 'gitStatusDeleted',
  ignored: null,
  modified: 'gitStatusModified',
  renamed: 'gitStatusRenamed',
  untracked: 'gitStatusUntracked',
};
