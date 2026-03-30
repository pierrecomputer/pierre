export type ContextMenuRequest = {
  itemId: string;
  anchorEl: HTMLElement | null;
};

export type ContextMenuFeatureConfig = {
  contextMenuEnabled?: boolean;
  onContextMenuRequest?: (request: ContextMenuRequest) => void;
};
