import type { TreeConfig } from '@headless-tree/core';
import { syncDataLoaderFeature } from '@headless-tree/core';
import type { JSX } from 'preact';

import type { FileTreeNode } from '../types';
import { Icon } from './Icon';
import { useTree } from './hooks/useTree';

export interface FileTreeRootProps {
  treeConfig: TreeConfig<FileTreeNode>;
  server?: boolean;
}

export function Root({ treeConfig }: FileTreeRootProps): JSX.Element {
  'use no memo';

  const tree = useTree<FileTreeNode>({
    ...treeConfig,
    features: [syncDataLoaderFeature],
  });

  return (
    <div {...tree.getContainerProps()}>
      {tree.getItems().map((item) => {
        // TODO: is it possible to have empty array as children? is this valid in that case?
        const hasChildren = item.getItemData()?.children != null;
        return (
          <div
            data-type="item"
            data-item-type={hasChildren ? 'folder' : 'file'}
            data-item-id={item.getId()}
            {...item.getProps()}
            key={item.getId()}
          >
            <div data-item-section="content">{item.getItemName()}</div>
            <div data-item-section="icon">
              {hasChildren ? <Icon name="file-tree-icon-chevron" /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
