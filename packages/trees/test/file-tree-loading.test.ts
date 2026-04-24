import { describe, expect, test } from 'bun:test';

import {
  FileTree,
  type FileTreeBulkIngestSource,
  type FileTreeControllerOptions,
  type FileTreeOptions,
  type FileTreeRevealLoadingSource,
} from '../src/index';
import { FileTreeController } from '../src/model/FileTreeController';

async function* emptyBulkChunks() {}

function createRevealSource(): FileTreeRevealLoadingSource {
  return {
    loadDirectories() {
      return Promise.resolve([]);
    },
    loadDirectory() {
      return Promise.resolve({ children: [] });
    },
  };
}

function createBulkSource(): FileTreeBulkIngestSource {
  return {
    openSession() {
      return Promise.resolve({
        chunks: emptyBulkChunks(),
        header: {},
      });
    },
  };
}

describe('file-tree loading api skeleton', () => {
  test('inactive controller loading methods return null and no-op unsubscribes', () => {
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/index.ts'],
    });

    const revealEvents: string[] = [];
    const bulkEvents: string[] = [];
    const stopReveal = controller.onRevealLoading('*', (event) => {
      revealEvents.push(event.type);
    });
    const stopBulk = controller.onBulkIngest('*', (event) => {
      bulkEvents.push(event.type);
    });

    expect(controller.getRevealLoadingInfo('src/')).toBeNull();
    expect(controller.getBulkIngestInfo()).toBeNull();

    stopReveal();
    stopBulk();
    expect(revealEvents).toEqual([]);
    expect(bulkEvents).toEqual([]);

    controller.destroy();
  });

  test('reveal mode exposes per-directory info for known directories', () => {
    const options = {
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      loading: {
        mode: 'reveal',
        source: createRevealSource(),
      },
      paths: ['src/index.ts'],
    } satisfies FileTreeControllerOptions;

    const controller = new FileTreeController(options);

    expect(controller.getRevealLoadingInfo('src/')).toEqual({
      path: 'src/',
      state: 'loaded',
    });
    expect(controller.getRevealLoadingInfo('src/index.ts')).toBeNull();
    expect(controller.getBulkIngestInfo()).toBeNull();

    const unsubscribe = controller.onRevealLoading('*', () => {
      throw new Error('phase 2 skeleton should not emit reveal events yet');
    });
    unsubscribe();
    controller.destroy();
  });

  test('bulk mode exposes idle aggregate info before the first ingest starts', () => {
    const options = {
      flattenEmptyDirectories: false,
      loading: {
        mode: 'bulk',
        source: createBulkSource(),
      },
    } satisfies FileTreeOptions;

    const fileTree = new FileTree(options);

    expect(fileTree.getRevealLoadingInfo('src/')).toBeNull();
    expect(fileTree.getBulkIngestInfo()).toEqual({
      ingestedPathCount: 0,
      status: 'idle',
    });

    const unsubscribe = fileTree.onBulkIngest('*', () => {
      throw new Error('phase 2 skeleton should not emit bulk events yet');
    });
    unsubscribe();
    fileTree.cleanUp();
  });
});
