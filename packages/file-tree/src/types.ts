export type FileList = string[];

export type FileTreeNodeChildren = {
  collapsed?: string[];
  direct: string[];
};

export type FileTreeNode = {
  name: string;
  children?: FileTreeNodeChildren;
  /** For collapsed nodes, lists the folder IDs that were collapsed into this node */
  collapses?: string[];
};

export type FileTreeData = Record<string, FileTreeNode>;
