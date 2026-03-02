'use client';

import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="pt-12 pb-12">
      <div className="grid-cols- grid gap-3 md:grid-cols-5 md:justify-between">
        <div className="text-muted-foreground text-sm">
          &copy; {new Date().getFullYear()} The Pierre Computer Co.
        </div>
        <div className="hidden md:block" />
        <div>
          <h4 className="mb-2 text-sm font-medium">Diffs</h4>
          <nav className="flex flex-col gap-1">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Home
            </Link>
            <Link
              href="/docs"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Docs
            </Link>
            <Link
              href="/playground"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Playground
            </Link>
            <Link
              href="/theme"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Theme
            </Link>
          </nav>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">Trees</h4>
          <nav className="flex flex-col gap-1">
            <Link
              href="/trees"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Home
            </Link>
            <Link
              href="/trees/docs"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Docs
            </Link>
          </nav>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">Community</h4>
          <nav className="flex flex-col gap-1">
            <Link
              href="https://x.com/pierrecomputer"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              X
            </Link>
            <Link
              href="https://discord.gg/pierre"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Discord
            </Link>
            <Link
              href="https://github.com/pierrecomputer/pierre"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              GitHub
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
