/** @jsxImportSource react */
'use client';

import type { ReactNode } from 'react';

import type { FileTreeOptions } from '../FileTree';
import { FILE_TREE_TAG_NAME } from '../constants';
import { useFileTreeInstance } from './utils/useFileTreeInstance';

function renderFileTreeChildren(): ReactNode {
  return <>{/* <div slot="fake-slot">METADATA</div> */}</>;
}

export function templateRender(
  children: ReactNode,
  __html: string | undefined
): ReactNode {
  if (typeof window === 'undefined' && __html != null) {
    return (
      <>
        <template
          // @ts-expect-error unclear how to fix this
          shadowrootmode="open"
          dangerouslySetInnerHTML={{ __html }}
        />
        {children}
      </>
    );
  }
  return <>{children}</>;
}

export interface FileTreeProps {
  options: FileTreeOptions;
  className?: string;
  style?: React.CSSProperties;
  prerenderedHTML?: string;
}

export function FileTree({
  options,
  className,
  style,
  prerenderedHTML,
}: FileTreeProps): React.JSX.Element {
  const children = renderFileTreeChildren();
  const { ref } = useFileTreeInstance({ options, prerenderedHTML });
  return (
    <FILE_TREE_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </FILE_TREE_TAG_NAME>
  );
}
