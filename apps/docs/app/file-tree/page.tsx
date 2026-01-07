// import { FileTree as FileTreeReact } from '@pierre/file-tree/react';
import { ClientPage } from './ClientPage';

export default function Home() {
  return (
    <div className="flex gap-4 p-4">
      {/* <FileTreeReact /> */}
      <div className="w-1/3 border border-gray-300">
        <div id="test-file-tree-elem" />
      </div>
      <ClientPage />
    </div>
  );
}
