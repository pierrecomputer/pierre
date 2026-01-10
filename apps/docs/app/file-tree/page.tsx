import { ClientPage } from './ClientPage';

export default function Home() {
  return (
    <div className="grid grid-cols-2 gap-4 p-4">
      <div className="w-2/3">
        <h2>Vanilla File Tree</h2>
        <div id="test-file-tree-elem" className="border border-gray-300" />
      </div>

      <ClientPage />
    </div>
  );
}
