import type { GitStatus } from '../types';

// These labels keep the status slot width stable while still distinguishing
// each supported git decoration in both tree renderers.
export const GIT_STATUS_LABEL: Record<GitStatus, string | null> = {
  added: 'A',
  copied: 'C',
  deleted: 'D',
  ignored: null,
  modified: 'M',
  renamed: 'R',
  untracked: 'U',
};

export const GIT_STATUS_TITLE: Record<GitStatus, string> = {
  added: 'Git status: added',
  copied: 'Git status: copied',
  deleted: 'Git status: deleted',
  ignored: 'Git status: ignored',
  modified: 'Git status: modified',
  renamed: 'Git status: renamed',
  untracked: 'Git status: untracked',
};

export const GIT_STATUS_DESCENDANT_TITLE = 'Contains git status items';
