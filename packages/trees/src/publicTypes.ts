export type GitStatus =
  | 'added'
  | 'deleted'
  | 'ignored'
  | 'modified'
  | 'renamed'
  | 'untracked';

export type GitStatusEntry = {
  path: string;
  status: GitStatus;
};

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
