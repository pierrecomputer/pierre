import type { GitStatus } from '../publicTypes';

export const GIT_STATUS_LABEL: Record<GitStatus, string | null> = {
  added: 'A',
  deleted: 'D',
  ignored: null,
  modified: 'M',
  renamed: 'R',
  untracked: 'U',
};

export const GIT_STATUS_TITLE: Record<GitStatus, string> = {
  added: 'Git status: added',
  deleted: 'Git status: deleted',
  ignored: 'Git status: ignored',
  modified: 'Git status: modified',
  renamed: 'Git status: renamed',
  untracked: 'Git status: untracked',
};

export const GIT_STATUS_DESCENDANT_TITLE = 'Contains git status items';
