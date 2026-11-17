import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import { describe, expect, test } from 'bun:test';

import { preparePresortedFileTreeInput } from '../src/index';
import { preparePresortedFileTreeBytes, wasmEngine } from '../src/wasm';
import { flushDom, installDom } from './helpers/dom';
import { loadFileTree, loadFileTreeController } from './helpers/loadFileTree';

const workload = getVirtualizationWorkload('demo-small');

function rowSummary(
  rows: ReadonlyArray<{ depth: number; expanded?: boolean; path: string }>
): string[] {
  return rows.map((row) => `${row.depth}:${row.path}`);
}

describe('file-tree wasm engine', () => {
  test('matches the default engine for rows, mutations, and expansion', async () => {
    const FileTreeController = await loadFileTreeController();
    const preparedInput = preparePresortedFileTreeInput(
      workload.presortedFiles
    );
    const controllers = [
      new FileTreeController({ initialExpansion: 'open', preparedInput }),
      new FileTreeController({
        engine: wasmEngine,
        initialExpansion: 'open',
        preparedInput,
      }),
    ];

    const [js, wasm] = controllers;
    expect(wasm.getVisibleCount()).toBe(js.getVisibleCount());
    expect(rowSummary(wasm.getVisibleRows(0, 50))).toEqual(
      rowSummary(js.getVisibleRows(0, 50))
    );

    for (const controller of controllers) {
      controller.batch([
        { path: 'alpha/src/new.ts', type: 'add' },
        { from: 'alpha/todo.txt', to: 'beta/todo.txt', type: 'move' },
        { path: 'gamma/', recursive: true, type: 'remove' },
      ]);
      const beta = controller.getItem('beta/');
      if (beta == null || !('collapse' in beta)) {
        throw new Error('beta/ should be a directory');
      }
      beta.collapse();
    }
    expect(wasm.getVisibleCount()).toBe(js.getVisibleCount());
    expect(rowSummary(wasm.getVisibleRows(0, 50))).toEqual(
      rowSummary(js.getVisibleRows(0, 50))
    );
    expect(wasm.getItem('beta/todo.txt')?.getPath()).toBe('beta/todo.txt');
    expect(js.getItem('beta/todo.txt')?.getPath()).toBe('beta/todo.txt');

    for (const controller of controllers) {
      controller.destroy();
    }
  });

  test('ingests newline-delimited bytes with the wasm engine', async () => {
    const FileTreeController = await loadFileTreeController();
    const bytes = new TextEncoder().encode(
      `${workload.presortedFiles.join('\n')}\n`
    );
    const fromBytes = new FileTreeController({
      engine: wasmEngine,
      initialExpansion: 'open',
      preparedInput: preparePresortedFileTreeBytes(bytes),
    });
    const fromStrings = new FileTreeController({
      initialExpansion: 'open',
      preparedInput: preparePresortedFileTreeInput(workload.presortedFiles),
    });
    expect(rowSummary(fromBytes.getVisibleRows(0, 50))).toEqual(
      rowSummary(fromStrings.getVisibleRows(0, 50))
    );
    fromBytes.destroy();
    fromStrings.destroy();
  });

  test('renders and resets a FileTree through the wasm engine', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const fileTree = new FileTree({
        engine: wasmEngine,
        initialExpansion: 'open',
        initialVisibleRowCount: 300 / 30,
        preparedInput: preparePresortedFileTreeInput(workload.presortedFiles),
      });
      fileTree.render({ containerWrapper: mount });
      await flushDom();
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      expect(
        shadowRoot?.querySelector('[data-item-path="alpha/src/app.ts"]')
      ).not.toBeNull();

      fileTree.resetPaths(['docs/guide.md', 'src/index.ts'], {
        preparedInput: preparePresortedFileTreeInput([
          'docs/guide.md',
          'src/index.ts',
        ]),
      });
      await flushDom();
      expect(
        shadowRoot?.querySelector('[data-item-path="src/index.ts"]')
      ).not.toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-path="alpha/src/app.ts"]')
      ).toBeNull();
      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
