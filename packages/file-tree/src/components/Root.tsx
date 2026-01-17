import { hotkeysCoreFeature, syncDataLoaderFeature } from '@headless-tree/core';
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { fileListToTree } from 'src/utils/fileListToTree';

import type { FileTreeOptions } from '../FileTree';
import { generateSyncDataLoader } from '../loader/sync';
import type { FileTreeNode } from '../types';
import { Icon } from './Icon';
import { useTree } from './hooks/useTree';

export interface FileTreeRootProps {
  fileTreeOptions: FileTreeOptions;
}

export function Root({ fileTreeOptions }: FileTreeRootProps): JSX.Element {
  'use no memo';
  const { config, files, collapseFolders } = fileTreeOptions;
  const { rootItemId, ...restTreeConfig } = config ?? {};
  const dataLoader = useMemo(
    () => generateSyncDataLoader(fileListToTree(files), { collapseFolders }),
    [files, collapseFolders]
  );

  const tree = useTree<FileTreeNode>({
    rootItemId: rootItemId ?? 'root',
    ...restTreeConfig,
    dataLoader,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => {
      const children = item.getItemData()?.children?.direct;
      return children != null;
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });

  return (
    <div {...tree.getContainerProps()}>
      {tree.getItems().map((item) => {
        // TODO: is it possible to have empty array as children? is this valid in that case?
        const hasChildren = item.getItemData()?.children?.direct != null;
        const isExpanded = item.isExpanded();
        return (
          <div
            data-type="item"
            data-item-type={hasChildren ? 'folder' : 'file'}
            data-item-id={item.getId()}
            {...item.getProps()}
            onKeyPress={(event) => {
              if (event.key === 'Enter') {
                if (isExpanded) {
                  item.collapse();
                } else {
                  item.expand();
                }
              }
            }}
            key={item.getId()}
          >
            <div data-item-section="spacing"></div>
            <div data-item-section="icon">
              {hasChildren ? <Icon name="file-tree-icon-chevron" /> : null}
            </div>
            <div data-item-section="content">{item.getItemName()}</div>
          </div>
        );
      })}
    </div>
  );
}
