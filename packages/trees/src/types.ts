export type FileList = string[];

export type GitStatus = 'added' | 'deleted' | 'modified';

export type GitStatusEntry = {
  path: string;
  status: GitStatus;
};

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

export type ContextMenuItem = { path: string; isFolder: boolean };

export type ContextMenuAnchorRect = Readonly<{
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
  x: number;
  y: number;
}>;

export type ContextMenuOpenContext = {
  anchorElement: HTMLElement;
  anchorRect: ContextMenuAnchorRect;
  close: () => void;
  canRename?: boolean;
  startRenaming?: () => void;
};
