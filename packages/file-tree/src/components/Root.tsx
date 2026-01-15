import type { TreeConfig } from '@headless-tree/core';
import { syncDataLoaderFeature } from '@headless-tree/core';
import type { JSX } from 'preact';

import { Icon } from './Icon';
import { useTree } from './hooks/useTree';

export interface FileTreeRootProps<T> {
  treeConfig: TreeConfig<T>;
  server?: boolean;
}

export function Root<T>({ treeConfig }: FileTreeRootProps<T>): JSX.Element {
  'use no memo';

  const tree = useTree({
    ...treeConfig,
    features: [syncDataLoaderFeature],
  });

  return (
    <div {...tree.getContainerProps()}>
      {tree.getItems().map((item) => {
        const hasChildren = (item.getItemData() as any)?.children != null;
        const props = item.getProps();
        return (
          <div
            data-type="item"
            data-item-type={hasChildren ? 'folder' : 'file'}
            data-item-id={item.getId()}
            {...props}
            onClick={() => {
              props.onClick?.bind(item);
              console.log('clicked', item.getId());
            }}
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
