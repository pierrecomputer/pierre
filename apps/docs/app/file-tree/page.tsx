import { preloadFileTree } from '@pierre/file-tree/ssr';
import { notFound } from 'next/navigation';

import { ClientPage } from './ClientPage';
import { sharedDemoFileTreeOptions } from './demo-data';

export default function FileTreePage() {
  if (process.env.NODE_ENV !== 'development') {
    return notFound();
  }
  return (
    <div className="grid grid-cols-2 gap-4 p-4">
      <div className="w-2/3">
        <h2>Vanilla File Tree</h2>
        <div id="test-file-tree-elem" className="border border-gray-300" />
      </div>

      <ClientPage
        preloadedFileTreeHtml={preloadFileTree(sharedDemoFileTreeOptions)}
      />
    </div>
  );
}
