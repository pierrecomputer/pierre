import type { JSX } from 'preact';
import type { FileTree } from 'src/FileTree';

import { Icon } from './Icon';

export interface FileTreeRootProps<T> {
  fileTree: FileTree<T>;
}

export function Root<T>({
  fileTree: fileTreeClassInstance,
}: FileTreeRootProps<T>): JSX.Element {
  const tree = fileTreeClassInstance.tree;
  if (tree == null) {
    throw new Error('FileTree: tree is not initialized');
  }

  return (
    <div {...tree.getContainerProps()}>
      {tree.getItems().map((item) => {
        const hasChildren = (item.getItemData() as any)?.children != null;
        const props = item.getProps();
        console.log('props', item.getId(), props);
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

/*
  const subtree =
 223 │     │      subtreeId != null
 224 │     │        ? this.tree.getItemInstance(subtreeId).getChildren()
 225 │     │        : this.tree.getItems();
 226 │     │    const listHtml = subtree
 227 │     │      ?.map((item: ItemInstance<any>) => {
 228 │     │        const itemData = item.getItemData();
 229 │     │        const itemProps = item.getProps();
 230 │     │        return `<div data-type="item" data-item-id="${item.getId()}" ${propsToHtm
l(itemProps)}>
 231 │     │          <div data-item-section="content">${itemData.name}</div>
 232 │     │          ${
 233 │     │            itemData.children != null && itemData.children.length > 0
 234 │     │              ? `<div data-item-section="icon">${iconHtml('file-tree-icon-chevron
')}</div>`
 235 │     │              : ''
 236 │     │          }
 237 │     │        </div>`;
 238 │     │      })
 239 │     │      .join('');
 240 │     │    const containerProps = this.tree.getContainerProps();
 241 │     │    if (subtreeId != null) {
 242 │     │      return listHtml;
 243 │     │    }
 244 │     │    return `<div ${propsToHtml(containerProps)}>${listHtml}</div>`;
 245 │     │  }
 246 │     │}*/
