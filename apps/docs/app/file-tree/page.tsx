import { FileTree } from '@pierre/file-tree';
import { preloadFileTree } from '@pierre/file-tree/ssr';

import { ClientPage } from './ClientPage';
import type { DemoItem } from './demo-data';
import { sharedDemoFileTreeOptions } from './demo-data';

export default function Home() {
  const fileTree = new FileTree(sharedDemoFileTreeOptions);
  return (
    <div className="grid grid-cols-2 gap-4 p-4">
      <div className="w-2/3">
        <h2>Vanilla File Tree</h2>
        <div id="test-file-tree-elem" className="border border-gray-300" />
      </div>

      <ClientPage preloadedFileTreeHtml={preloadFileTree<DemoItem>(fileTree)} />
    </div>
  );
}
