import { ClientPage } from './ClientPage';

const preloadedFileTreeHtml = `<style>
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
<div id="file-tree-div-wrapper">
  <div>File Tree Fake</div>
</div>`;

export default function Home() {
  return (
    <div className="grid grid-cols-2 gap-4 p-4">
      <div className="w-2/3">
        <h2>Vanilla File Tree</h2>
        <div id="test-file-tree-elem" className="border border-gray-300" />
      </div>

      <ClientPage preloadedFileTreeHtml={preloadedFileTreeHtml} />
    </div>
  );
}
