import { FileTreeReact as FileTree } from './FileTreeReact';

export default function FileTreePage() {
  return (
    <div>
      <h1>File Tree</h1>
      <FileTree files={[{ name: 'foo' }, { name: 'bar' }]} />
    </div>
  );
}
