import {
  type TreeInstance,
  hotkeysCoreFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core';
import type { JSX } from 'preact';
import { Fragment } from 'preact';
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

function FlattenedDirectoryName({
  tree,
  flattens,
}: {
  tree: TreeInstance<FileTreeNode>;
  flattens: string[];
}): JSX.Element {
  'use no memo';
  const flattenedItems = useMemo(() => {
    return flattens.map((name) => tree.getItemInstance(name));
  }, [flattens, tree]);
  return (
    <span data-item-flattened-subitems>
      {flattenedItems.map((item, index) => {
        const isLast = index === flattenedItems.length - 1;

        return (
          <Fragment key={index}>
            <span data-item-flattened-subitem={item.getId()}>
              {item.getItemName()}
            </span>
            {!isLast ? '/' : ''}
          </Fragment>
        );
      })}
    </span>
  );
}

export function Root({ fileTreeOptions }: FileTreeRootProps): JSX.Element {
  'use no memo';
  const { config, files, flattenEmptyDirectories } = fileTreeOptions;
  const { rootItemId, ...restTreeConfig } = config ?? {};
  const dataLoader = useMemo(
    () =>
      generateSyncDataLoader(fileListToTree(files), {
        flattenEmptyDirectories,
      }),
    [files, flattenEmptyDirectories]
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
        const itemData = item.getItemData();
        const itemMeta = item.getItemMeta();
        // TODO: is it possible to have empty array as children? is this valid in that case?
        const hasChildren = itemData?.children?.direct != null;
        const isExpanded = item.isExpanded();
        const itemName = item.getItemName();
        const level = itemMeta.level;
        const startWithCapital =
          itemName.charAt(0).toUpperCase() === itemName.charAt(0);
        const alignCapitals = startWithCapital;

        const isFlattenedDirectory = itemData?.flattens != null;
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
            <div data-item-section="spacing">
              {Array.from({ length: level }).map((_, index) => (
                <div key={index} data-item-section="spacing-item" />
              ))}
            </div>
            <div data-item-section="icon">
              {hasChildren ? (
                <Icon
                  name="file-tree-icon-chevron"
                  alignCapitals={alignCapitals}
                />
              ) : (
                <Icon name="file-tree-icon-file" />
              )}
            </div>
            <div data-item-section="content">
              {isFlattenedDirectory ? (
                <FlattenedDirectoryName
                  tree={tree}
                  flattens={itemData?.flattens ?? []}
                />
              ) : (
                itemName
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
