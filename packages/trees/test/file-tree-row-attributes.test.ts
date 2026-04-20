import { describe, expect, test } from 'bun:test';

import type { FileTreeVisibleRow } from '../src/model/types';
import {
  computeFileTreeRowElementAttributes,
  type FileTreeRowElementAttributesInput,
  type FileTreeRowFeatureFlags,
  type FileTreeRowStateFlags,
} from '../src/render/fileTreeRowAttributes';

function makeRow(
  overrides: Partial<FileTreeVisibleRow> = {}
): FileTreeVisibleRow {
  return {
    ancestorPaths: ['src/'],
    depth: 1,
    hasChildren: true,
    index: 7,
    isExpanded: true,
    isFlattened: false,
    isFocused: false,
    isSelected: false,
    kind: 'directory',
    level: 1,
    name: 'lib',
    path: 'src/lib/',
    posInSet: 2,
    setSize: 5,
    ...overrides,
  };
}

const baseFeatures: FileTreeRowFeatureFlags = {
  actionLaneEnabled: false,
  contextMenuButtonVisibility: null,
  contextMenuEnabled: false,
  contextMenuTriggerMode: null,
  gitLaneActive: false,
};

const baseState: FileTreeRowStateFlags = {
  containsGitChange: false,
  effectiveGitStatus: null,
  isContextHovered: false,
  isDragTarget: false,
  isDragging: false,
  isFocusRinged: false,
};

function makeInput(
  overrides: Partial<FileTreeRowElementAttributesInput> = {}
): FileTreeRowElementAttributesInput {
  return {
    ariaLabel: 'lib folder',
    domId: undefined,
    extraStyle: undefined,
    features: baseFeatures,
    isParked: false,
    itemHeight: 30,
    mode: 'flow',
    row: makeRow(),
    state: baseState,
    targetPath: 'src/lib/',
    ...overrides,
  };
}

describe('computeFileTreeRowElementAttributes', () => {
  test('flow rows expose full treeitem a11y contract', () => {
    const attrs = computeFileTreeRowElementAttributes(makeInput());
    expect(attrs.role).toBe('treeitem');
    expect(attrs['aria-level']).toBe(2);
    expect(attrs['aria-posinset']).toBe(3);
    expect(attrs['aria-setsize']).toBe(5);
    expect(attrs['aria-selected']).toBe('false');
    expect(attrs['aria-expanded']).toBe(true);
    expect(attrs['data-file-tree-sticky-row']).toBeUndefined();
    expect(attrs['data-file-tree-sticky-path']).toBeUndefined();
  });

  test('sticky rows strip treeitem semantics so the aria-hidden mirror stays invisible to AT', () => {
    const attrs = computeFileTreeRowElementAttributes(
      makeInput({ mode: 'sticky' })
    );
    expect(attrs.role).toBeUndefined();
    expect(attrs['aria-level']).toBeUndefined();
    expect(attrs['aria-posinset']).toBeUndefined();
    expect(attrs['aria-setsize']).toBeUndefined();
    expect(attrs['aria-selected']).toBeUndefined();
    expect(attrs['aria-expanded']).toBeUndefined();
    expect(attrs.tabIndex).toBe(-1);
    expect(attrs['data-file-tree-sticky-row']).toBe('true');
    expect(attrs['data-file-tree-sticky-path']).toBe('src/lib/');
    expect(attrs.id).toBeUndefined();
  });

  test('sticky rows keep all lane-structure data attributes so CSS stays in sync with canonical', () => {
    const attrs = computeFileTreeRowElementAttributes(
      makeInput({
        features: {
          ...baseFeatures,
          actionLaneEnabled: true,
          contextMenuButtonVisibility: 'always',
          contextMenuEnabled: true,
          contextMenuTriggerMode: 'button',
          gitLaneActive: true,
        },
        mode: 'sticky',
      })
    );
    expect(attrs['data-item-has-context-menu-action-lane']).toBe('true');
    expect(attrs['data-item-has-git-lane']).toBe('true');
    expect(attrs['data-item-context-menu-button-visibility']).toBe('always');
    expect(attrs['data-item-context-menu-trigger-mode']).toBe('button');
    expect(attrs['aria-haspopup']).toBe('menu');
  });

  test('flow focused row sets tabIndex 0 and the domId', () => {
    const attrs = computeFileTreeRowElementAttributes(
      makeInput({
        domId: 'instance__row-src/lib/',
        row: makeRow({ isFocused: true }),
      })
    );
    expect(attrs.tabIndex).toBe(0);
    expect(attrs.id).toBe('instance__row-src/lib/');
  });

  test('sticky rows never expose the focused domId even if the row is logically focused', () => {
    const attrs = computeFileTreeRowElementAttributes(
      makeInput({
        domId: 'instance__row-src/lib/',
        mode: 'sticky',
        row: makeRow({ isFocused: true }),
      })
    );
    expect(attrs.tabIndex).toBe(-1);
    expect(attrs.id).toBeUndefined();
  });

  test('aria-selected mirrors row.isSelected and is present only in flow mode', () => {
    const flowSelected = computeFileTreeRowElementAttributes(
      makeInput({ row: makeRow({ isSelected: true }) })
    );
    const stickySelected = computeFileTreeRowElementAttributes(
      makeInput({ mode: 'sticky', row: makeRow({ isSelected: true }) })
    );
    expect(flowSelected['aria-selected']).toBe('true');
    expect(flowSelected['data-item-selected']).toBe(true);
    expect(stickySelected['aria-selected']).toBeUndefined();
    expect(stickySelected['data-item-selected']).toBe(true);
  });

  test('files render aria-expanded undefined and data-item-type=file', () => {
    const attrs = computeFileTreeRowElementAttributes(
      makeInput({ row: makeRow({ kind: 'file' }) })
    );
    expect(attrs['aria-expanded']).toBeUndefined();
    expect(attrs['data-item-type']).toBe('file');
  });

  test('parent path omitted at the top level and included otherwise', () => {
    const top = computeFileTreeRowElementAttributes(
      makeInput({ row: makeRow({ ancestorPaths: [] }) })
    );
    const nested = computeFileTreeRowElementAttributes(makeInput());
    expect(top['data-item-parent-path']).toBeUndefined();
    expect(nested['data-item-parent-path']).toBe('src/');
  });

  test('parked rows advertise parked via data attribute without losing treeitem role', () => {
    const attrs = computeFileTreeRowElementAttributes(
      makeInput({ isParked: true, row: makeRow({ isFocused: true }) })
    );
    expect(attrs['data-item-parked']).toBe('true');
    expect(attrs.role).toBe('treeitem');
  });

  test('state flags produce data-item-* attributes only when truthy', () => {
    const attrs = computeFileTreeRowElementAttributes(
      makeInput({
        state: {
          containsGitChange: true,
          effectiveGitStatus: 'modified',
          isContextHovered: true,
          isDragTarget: true,
          isDragging: true,
          isFocusRinged: true,
        },
      })
    );
    expect(attrs['data-item-focused']).toBe(true);
    expect(attrs['data-item-context-hover']).toBe('true');
    expect(attrs['data-item-drag-target']).toBe(true);
    expect(attrs['data-item-dragging']).toBe(true);
    expect(attrs['data-item-git-status']).toBe('modified');
    expect(attrs['data-item-contains-git-change']).toBe('true');
  });

  test('style merges extraStyle on top of itemHeight minHeight', () => {
    const attrs = computeFileTreeRowElementAttributes(
      makeInput({
        extraStyle: { position: 'absolute', top: '30px' },
        itemHeight: 28,
      })
    );
    expect(attrs.style).toEqual({
      minHeight: '28px',
      position: 'absolute',
      top: '30px',
    });
  });

  test('context-menu feature flag gates aria-haspopup', () => {
    const enabled = computeFileTreeRowElementAttributes(
      makeInput({
        features: { ...baseFeatures, contextMenuEnabled: true },
      })
    );
    const disabled = computeFileTreeRowElementAttributes(makeInput());
    expect(enabled['aria-haspopup']).toBe('menu');
    expect(disabled['aria-haspopup']).toBeUndefined();
  });

  test('actionLane disabled removes the trigger-mode attribute even if context menu is on', () => {
    const attrs = computeFileTreeRowElementAttributes(
      makeInput({
        features: {
          ...baseFeatures,
          actionLaneEnabled: false,
          contextMenuButtonVisibility: 'when-needed',
          contextMenuEnabled: true,
          contextMenuTriggerMode: 'button',
        },
      })
    );
    expect(attrs['data-item-has-context-menu-action-lane']).toBeUndefined();
    expect(attrs['data-item-context-menu-button-visibility']).toBeUndefined();
    expect(attrs['data-item-context-menu-trigger-mode']).toBe('button');
  });
});
