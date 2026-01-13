import { FileTree } from '@pierre/file-tree';

import { ClientPage } from './ClientPage';
import type { DemoItem } from './demo-data';
import { sharedDemoFileTreeOptions } from './demo-data';

function getPreloadedFileTreeHtml(fileTree: FileTree<DemoItem>): string {
  return `<style>
@layer base, theme, unsafe;

@layer base {
  :host {
    color-scheme: light dark;
    display: block;
    font-family:
      'SF Mono', Monaco, Consolas, 'Ubuntu Mono', 'Liberation Mono',
      'Courier New', monospace;
  }
}
</style>
<div data-file-tree-id="${fileTree.__id}" data-dehydrated>
  ${fileTree.generateFileTreeFake()}
</div>`;
}

export default function Home() {
  const fileTree = new FileTree(sharedDemoFileTreeOptions);
  return (
    <div className="grid grid-cols-2 gap-4 p-4">
      <div className="w-2/3">
        <h2>Vanilla File Tree</h2>
        <div id="test-file-tree-elem" className="border border-gray-300" />
      </div>

      <ClientPage preloadedFileTreeHtml={getPreloadedFileTreeHtml(fileTree)} />
    </div>
  );
}
