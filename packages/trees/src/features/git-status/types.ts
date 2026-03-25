export type { GitStatusEntry } from '../../types';

export type GitStatusConfig = {
  gitStatus?: import('../../types').GitStatusEntry[];
  gitStatusSignature?: string;
  gitStatusPathToId?: Map<string, string>;
};
