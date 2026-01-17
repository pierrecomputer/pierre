import { preloadFileTree } from '@pierre/file-tree/ssr';
import { notFound } from 'next/navigation';

import { ClientPage } from './ClientPage';
import { sharedDemoFileTreeOptions } from './demo-data';

export default function FileTreePage() {
  if (process.env.NODE_ENV !== 'development') {
    return notFound();
  }
  return (
    <ClientPage
      preloadedFileTreeHtml={preloadFileTree(sharedDemoFileTreeOptions)}
    />
  );
}
