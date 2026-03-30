export type GitStatusConfig = {
  gitStatus?: import('../../types').GitStatusEntry[];
  gitStatusSignature?: string;
  gitStatusPathToId?: import('../../utils/pathLookups').PathToIdLookup;
};
