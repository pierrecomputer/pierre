import DocsSidebar from '../../components/DocsSidebar';
import Header from '../../components/Header';
import '../css/index.css';

export default function DocsPage() {
  return (
    <div className="container">
      <Header />

      <div className="docs-container">
        <DocsSidebar />
        <main className="docs-main">
          <h2>Install</h2>
        </main>
      </div>
    </div>
  );
}
