import {
  type TreeInstance,
  expandAllFeature,
  hotkeysCoreFeature,
  selectionFeature,
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
    hotkeys: {
      // Begin the hotkey name with "custom" to satisfy the type checker
      customExpandAll: {
        hotkey: 'KeyQ',
        handler: (_e, tree) => {
          void tree.expandAll();
        },
      },
      customCollapseAll: {
        hotkey: 'KeyW',
        handler: (_e, tree) => {
          void tree.collapseAll();
        },
      },
    },
    features: [
      syncDataLoaderFeature,
      hotkeysCoreFeature,
      selectionFeature,
      expandAllFeature,
    ],
  });

  return (
    <div {...tree.getContainerProps()}>
      {tree.getItems().map((item) => {
        const itemData = item.getItemData();
        const itemMeta = item.getItemMeta();
        // TODO: is it possible to have empty array as children? is this valid in that case?
        const hasChildren = itemData?.children?.direct != null;
        const itemName = item.getItemName();
        const level = itemMeta.level;
        const startWithCapital =
          itemName.charAt(0).toUpperCase() === itemName.charAt(0);
        const alignCapitals = startWithCapital;
        const isSelected = item.isSelected();
        const selectionProps = isSelected ? { 'data-item-selected': true } : {};

        const isFlattenedDirectory = itemData?.flattens != null;
        return (
          <button
            data-type="item"
            data-item-type={hasChildren ? 'folder' : 'file'}
            {...selectionProps}
            data-item-id={item.getId()}
            {...item.getProps()}
            key={item.getId()}
          >
            {level > 0 ? (
              <div data-item-section="spacing">
                {Array.from({ length: level }).map((_, index) => (
                  <div key={index} data-item-section="spacing-item" />
                ))}
              </div>
            ) : null}
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
          </button>
        );
      })}
    </div>
  );
}
