import { version } from '@pierre/file-tree';
import { FileTree } from '@pierre/file-tree/react';

export default function Home() {
  return (
    <div>
      <h1>File Tree</h1>
      <p>version: {version}</p>
      <FileTree />
    </div>
  );
}
