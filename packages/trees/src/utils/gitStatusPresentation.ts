import type { GitStatus } from '../publicTypes';

export const GIT_STATUS_LABEL: Record<GitStatus, string | null> = {
  added: 'A',
  deleted: 'D',
  ignored: null,
  modified: 'M',
  renamed: 'R',
  untracked: 'U',
};
