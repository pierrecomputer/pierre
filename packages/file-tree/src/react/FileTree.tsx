'use client';

import type { ReactNode } from 'react';

import { FILE_TREE_TAG_NAME } from '../constants';

function renderFileTreeChildren(): ReactNode {
  return (
    <>
      <div slot="fake-slot">METADATA</div>
    </>
  );
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
  className?: string;
  style?: React.CSSProperties;
  prerenderedHTML?: string;
}

export function FileTree({
  className,
  style,
  prerenderedHTML,
}: FileTreeProps): React.JSX.Element {
  const children = renderFileTreeChildren();
  return (
    <FILE_TREE_TAG_NAME className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </FILE_TREE_TAG_NAME>
  );
}
