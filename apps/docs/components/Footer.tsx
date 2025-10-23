import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="pt-12 pb-12">
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-sm">Precision Diffs</div>
        <nav className="flex items-center gap-4">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Home
          </Link>
          {/* <Link
            href="/playground"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Playground
          </Link> */}
          <Link
            href="/docs"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Docs
          </Link>
        </nav>
      </div>
    </footer>
  );
}
