export type FileList = string[];

export type FileTreeNodeChildren = {
  flattened?: string[];
  direct: string[];
};

export type FileTreeNode = {
  name: string;
  /** Original path key used to build the tree (not hashed). */
  path: string;
  children?: FileTreeNodeChildren;
  /** For flattened nodes, lists the folder IDs that were flattened into this node */
  flattens?: string[];
};

export type FileTreeData = Record<string, FileTreeNode>;
