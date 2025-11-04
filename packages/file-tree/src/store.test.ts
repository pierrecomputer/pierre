import { describe, expect, test } from 'bun:test';
import { createFileTreeStore, type TreeNode } from './store';

describe('FileTreeStore', () => {
  test('should create a new store with empty data', () => {
    const store = createFileTreeStore();
    expect(store.data.get()).toEqual([]);
    expect(store.openIds.get().size).toBe(0);
  });

  test('should set tree data', () => {
    const store = createFileTreeStore();
    const nodes: TreeNode[] = [
      { id: '1', name: 'File 1' },
      { id: '2', name: 'File 2' },
    ];

    store.setData(nodes);

    expect(store.data.get()).toEqual(nodes);
  });

  test('should toggle node open state', () => {
    const store = createFileTreeStore();

    // Initially closed
    expect(store.isOpen('1')).toBe(false);

    // Toggle to open
    store.toggle('1');
    expect(store.isOpen('1')).toBe(true);

    // Toggle back to closed
    store.toggle('1');
    expect(store.isOpen('1')).toBe(false);
  });

  test('should open a node', () => {
    const store = createFileTreeStore();

    store.open('1');
    expect(store.isOpen('1')).toBe(true);

    // Opening again should not change state
    store.open('1');
    expect(store.isOpen('1')).toBe(true);
  });

  test('should close a node', () => {
    const store = createFileTreeStore();

    store.open('1');
    expect(store.isOpen('1')).toBe(true);

    store.close('1');
    expect(store.isOpen('1')).toBe(false);

    // Closing again should not change state
    store.close('1');
    expect(store.isOpen('1')).toBe(false);
  });

  test('should open all nodes', () => {
    const store = createFileTreeStore();
    const nodes: TreeNode[] = [
      {
        id: '1',
        name: 'Folder 1',
        children: [
          { id: '1.1', name: 'File 1.1' },
          { id: '1.2', name: 'File 1.2' },
        ],
      },
      {
        id: '2',
        name: 'Folder 2',
        children: [
          {
            id: '2.1',
            name: 'Subfolder 2.1',
            children: [{ id: '2.1.1', name: 'File 2.1.1' }],
          },
        ],
      },
    ];

    store.setData(nodes);
    store.openAll();

    expect(store.isOpen('1')).toBe(true);
    expect(store.isOpen('1.1')).toBe(true);
    expect(store.isOpen('1.2')).toBe(true);
    expect(store.isOpen('2')).toBe(true);
    expect(store.isOpen('2.1')).toBe(true);
    expect(store.isOpen('2.1.1')).toBe(true);
  });

  test('should close all nodes', () => {
    const store = createFileTreeStore();
    const nodes: TreeNode[] = [
      {
        id: '1',
        name: 'Folder 1',
        children: [
          { id: '1.1', name: 'File 1.1' },
        ],
      },
    ];

    store.setData(nodes);
    store.openAll();

    expect(store.isOpen('1')).toBe(true);
    expect(store.isOpen('1.1')).toBe(true);

    store.closeAll();

    expect(store.isOpen('1')).toBe(false);
    expect(store.isOpen('1.1')).toBe(false);
  });

  test('should track multiple open nodes', () => {
    const store = createFileTreeStore();

    store.open('1');
    store.open('2');
    store.open('3');

    expect(store.isOpen('1')).toBe(true);
    expect(store.isOpen('2')).toBe(true);
    expect(store.isOpen('3')).toBe(true);
    expect(store.openIds.get().size).toBe(3);
  });

  test('should provide openIdsArray computed signal', () => {
    const store = createFileTreeStore();

    store.open('1');
    store.open('2');

    const openArray = store.openIdsArray.get();
    expect(openArray).toContain('1');
    expect(openArray).toContain('2');
    expect(openArray.length).toBe(2);
  });

  test('should handle nested tree structure', () => {
    const store = createFileTreeStore();
    const nodes: TreeNode[] = [
      {
        id: 'root',
        name: 'Root',
        children: [
          {
            id: 'folder-a',
            name: 'Folder A',
            children: [
              { id: 'file-1', name: 'file1.txt' },
              { id: 'file-2', name: 'file2.txt' },
            ],
          },
          {
            id: 'folder-b',
            name: 'Folder B',
            children: [
              {
                id: 'subfolder-b1',
                name: 'Subfolder B1',
                children: [
                  { id: 'file-3', name: 'file3.txt' },
                ],
              },
            ],
          },
        ],
      },
    ];

    store.setData(nodes);

    // Open specific nodes
    store.open('root');
    store.open('folder-b');
    store.open('subfolder-b1');

    expect(store.isOpen('root')).toBe(true);
    expect(store.isOpen('folder-a')).toBe(false);
    expect(store.isOpen('folder-b')).toBe(true);
    expect(store.isOpen('subfolder-b1')).toBe(true);
  });
});
