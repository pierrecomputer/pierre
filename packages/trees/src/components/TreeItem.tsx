/** @jsxImportSource preact */
import { Component, createElement, Fragment } from 'preact';
import type { FunctionComponent, JSX } from 'preact';
import { useMemo } from 'preact/hooks';

import type { ItemInstance, TreeInstance } from '../core/types/core';
import type { SVGSpriteNames } from '../sprite';
import type { FileTreeNode } from '../types';
import { Icon } from './Icon';
import { MiddleTruncate, Truncate } from './OverflowText';

// Local memo implementation to avoid importing from preact/compat, which
// declares `export as namespace React` and pollutes the global type namespace,
// breaking the React wrapper's JSX types.
function memo<P>(
  c: FunctionComponent<P>,
  comparer: (prev: P, next: P) => boolean
): FunctionComponent<P> {
  class Memoed extends Component<P> {
    override shouldComponentUpdate(nextProps: P) {
      return !comparer(this.props as P, nextProps);
    }
    override render() {
      return createElement(
        c as FunctionComponent,
        this.props as Record<string, unknown>
      );
    }
  }
  Memoed.displayName = `Memo(${c.displayName ?? c.name ?? 'Component'})`;
  return Memoed as unknown as FunctionComponent<P>;
}

function RenameInput({
  ariaLabel,
  isFlattened,
  renameInputProps,
}: {
  ariaLabel: string;
  isFlattened?: boolean;
  renameInputProps: Record<string, unknown>;
}): JSX.Element {
  return (
    <input
      data-item-rename-input
      {...(isFlattened === true
        ? { 'data-item-flattened-rename-input': true }
        : {})}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      {...renameInputProps}
    />
  );
}

function FlattenedDirectoryName({
  tree,
  idToPath,
  flattens,
  fallbackName,
  renameInputProps,
}: {
  tree: TreeInstance<FileTreeNode>;
  idToPath: Map<string, string>;
  flattens: string[];
  fallbackName: string;
  renameInputProps?: Record<string, unknown> | null;
}): JSX.Element {
  'use no memo';
  const segments = useMemo(() => {
    const result: { id: string; label: string }[] = [];
    for (const id of flattens) {
      const item = tree.getItemInstance(id);
      if (item != null) {
        result.push({ id: item.getId(), label: item.getItemName() });
      } else {
        const path = idToPath.get(id);
        const label = path != null ? (path.split('/').pop() ?? id) : id;
        result.push({ id, label });
      }
    }
    return result;
  }, [flattens, tree, idToPath]);

  if (segments.length === 0) {
    if (renameInputProps != null) {
      return (
        <RenameInput
          ariaLabel={`Rename ${fallbackName}`}
          isFlattened
          renameInputProps={renameInputProps}
        />
      );
    }
    return (
      <span data-item-flattened-subitems>
        {fallbackName.replace(/\//g, ' / ')}
      </span>
    );
  }

  return (
    <span data-item-flattened-subitems>
      {segments.map(({ id, label }, index) => {
        const isLast = index === segments.length - 1;
        return (
          <Fragment key={id}>
            <span data-item-flattened-subitem={id}>
              {isLast && renameInputProps != null ? (
                <RenameInput
                  ariaLabel={`Rename ${label}`}
                  isFlattened
                  renameInputProps={renameInputProps}
                />
              ) : (
                <Truncate>{label}</Truncate>
              )}
            </span>
            {!isLast ? ' / ' : ''}
          </Fragment>
        );
      })}
    </span>
  );
}

export interface TreeItemProps {
  item: ItemInstance<FileTreeNode>;
  tree: TreeInstance<FileTreeNode>;
  itemId: string;
  hasChildren: boolean;
  isExpanded: boolean;
  itemName: string;
  level: number;
  isSelected: boolean;
  isFocused: boolean;
  isSearchMatch: boolean;
  isDragTarget: boolean;
  isDragging: boolean;
  isDnD: boolean;
  isRenaming: boolean;
  isFlattenedDirectory: boolean;
  isLocked: boolean;
  gitStatus: string | undefined;
  containsGitChange: boolean;
  flattens: string[] | undefined;
  idToPath: Map<string, string>;
  ancestors: string[];
  treeDomId: string;
  remapIcon: (name: SVGSpriteNames) => {
    name: string;
    remappedFrom?: string;
    width?: number;
    height?: number;
    viewBox?: string;
  };
  detectFlattenedSubfolder: (e: DragEvent) => void;
  clearFlattenedSubfolder: () => void;
}

function treeItemPropsAreEqual(
  prev: Readonly<TreeItemProps>,
  next: Readonly<TreeItemProps>
): boolean {
  return (
    prev.itemId === next.itemId &&
    prev.hasChildren === next.hasChildren &&
    prev.isExpanded === next.isExpanded &&
    prev.itemName === next.itemName &&
    prev.level === next.level &&
    prev.isSelected === next.isSelected &&
    prev.isFocused === next.isFocused &&
    prev.isSearchMatch === next.isSearchMatch &&
    prev.isDragTarget === next.isDragTarget &&
    prev.isDragging === next.isDragging &&
    prev.isDnD === next.isDnD &&
    prev.isRenaming === next.isRenaming &&
    prev.isFlattenedDirectory === next.isFlattenedDirectory &&
    prev.isLocked === next.isLocked &&
    prev.gitStatus === next.gitStatus &&
    prev.containsGitChange === next.containsGitChange &&
    prev.flattens === next.flattens &&
    prev.ancestors === next.ancestors &&
    prev.treeDomId === next.treeDomId
  );
}

function TreeItemInner({
  item,
  tree,
  itemId,
  hasChildren,
  itemName,
  level,
  isSelected,
  isFocused,
  isSearchMatch,
  isDragTarget,
  isDragging,
  isDnD,
  isRenaming,
  isFlattenedDirectory,
  isLocked,
  gitStatus: itemGitStatus,
  containsGitChange: itemContainsGitChange,
  flattens,
  idToPath,
  ancestors,
  treeDomId,
  remapIcon,
  detectFlattenedSubfolder,
  clearFlattenedSubfolder,
}: TreeItemProps): JSX.Element {
  'use no memo';
  const startWithCapital =
    itemName.charAt(0).toUpperCase() === itemName.charAt(0);
  const alignCapitals = startWithCapital;

  const selectionProps = isSelected ? { 'data-item-selected': true } : {};
  const focusedProps = isFocused ? { 'data-item-focused': true } : {};
  const searchMatchProps = isSearchMatch
    ? { 'data-item-search-match': true }
    : {};
  const dragProps = isDnD
    ? {
        ...(isDragTarget && { 'data-item-drag-target': true }),
        ...(isDragging && { 'data-item-dragging': true }),
      }
    : {};
  const gitStatusProps = {
    ...(itemGitStatus != null && {
      'data-item-git-status': itemGitStatus,
    }),
    ...(itemContainsGitChange && {
      'data-item-contains-git-change': 'true',
    }),
  };

  const baseProps = item.getProps();
  const itemProps =
    isDnD && isFlattenedDirectory
      ? {
          ...baseProps,
          onDragOver: (e: DragEvent) => {
            (baseProps.onDragOver as ((e: DragEvent) => void) | undefined)?.(e);
            detectFlattenedSubfolder(e);
          },
          onDragLeave: (e: DragEvent) => {
            clearFlattenedSubfolder();
            (baseProps.onDragLeave as ((e: DragEvent) => void) | undefined)?.(
              e
            );
          },
          onDrop: (e: DragEvent) => {
            (baseProps.onDrop as ((e: DragEvent) => void) | undefined)?.(e);
            clearFlattenedSubfolder();
          },
        }
      : baseProps;
  const statusLabel =
    itemGitStatus === 'added'
      ? 'A'
      : itemGitStatus === 'deleted'
        ? 'D'
        : itemGitStatus === 'modified'
          ? 'M'
          : null;
  const showStatusDot = statusLabel == null && itemContainsGitChange;
  const renameInputProps =
    isRenaming && item.getRenameInputProps != null
      ? item.getRenameInputProps()
      : null;

  const getItemDomId = (id: string) => `${treeDomId}-${id}`;

  return (
    <button
      data-type="item"
      data-item-type={hasChildren ? 'folder' : 'file'}
      aria-label={itemName}
      {...selectionProps}
      {...searchMatchProps}
      {...focusedProps}
      {...dragProps}
      {...gitStatusProps}
      data-item-id={itemId}
      id={getItemDomId(itemId)}
      {...itemProps}
      key={itemId}
    >
      {level > 0 ? (
        <div data-item-section="spacing">
          {Array.from({ length: level }).map((_, index) => (
            <div
              key={index}
              data-item-section="spacing-item"
              data-ancestor-id={ancestors[index]}
            />
          ))}
        </div>
      ) : null}
      <div data-item-section="icon">
        {hasChildren ? (
          <Icon
            {...remapIcon('file-tree-icon-chevron')}
            alignCapitals={alignCapitals}
          />
        ) : (
          <Icon {...remapIcon('file-tree-icon-file')} />
        )}
      </div>
      <div data-item-section="content">
        {isFlattenedDirectory ? (
          <FlattenedDirectoryName
            tree={tree}
            idToPath={idToPath}
            flattens={flattens ?? []}
            fallbackName={itemName}
            renameInputProps={renameInputProps}
          />
        ) : renameInputProps != null ? (
          <RenameInput
            ariaLabel={`Rename ${itemName}`}
            renameInputProps={renameInputProps}
          />
        ) : (
          <MiddleTruncate minimumLength={5} split="extension">
            {itemName}
          </MiddleTruncate>
        )}
      </div>

      {statusLabel || showStatusDot ? (
        <div data-item-section="status">
          {statusLabel ?? (
            <Icon {...remapIcon('file-tree-icon-dot')} width={6} height={6} />
          )}
        </div>
      ) : null}
      {isLocked ? (
        <div data-item-section="lock">
          <Icon {...remapIcon('file-tree-icon-lock')} />
        </div>
      ) : null}
    </button>
  );
}

export const TreeItem = memo(TreeItemInner, treeItemPropsAreEqual);
