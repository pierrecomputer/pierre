export type GitStatusConfig = {
  gitStatus?: import('../../types').GitStatusEntry[];
  gitStatusSignature?: string;
  gitStatusPathToId?: Map<string, string>;
};
