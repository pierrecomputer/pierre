export type FileList = string[];

export type FileTreeNode = {
  name: string;
  children?: string[];
};

export type FileTree = Record<string, FileTreeNode>;
