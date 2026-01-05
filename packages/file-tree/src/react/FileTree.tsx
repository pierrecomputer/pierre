'use client';

import { FILE_TREE_TAG_NAME } from '../constants';

export interface FileTreeProps {
  className?: string;
  style?: React.CSSProperties;
}

export function FileTree({
  className,
  style,
}: FileTreeProps): React.JSX.Element {
  return (
    <FILE_TREE_TAG_NAME className={className} style={style}>
      fake file tree
    </FILE_TREE_TAG_NAME>
  );
}
