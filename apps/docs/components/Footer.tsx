'use client';

import Link from 'next/link';

import { getExternalUrl, PRODUCTS } from '@/app/product-config';

const siteProduct = process.env.NEXT_PUBLIC_SITE ?? 'diffs';
const isTrees = siteProduct === 'trees';

const linkClass =
  'text-muted-foreground hover:text-foreground text-sm transition-colors';

export default function Footer() {
  const diffsExternal = getExternalUrl('diffs');
  const treesExternal = getExternalUrl('trees');

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
            {isTrees ? (
              <>
                <a href={diffsExternal} className={linkClass}>
                  Home
                </a>
                <a href={`${diffsExternal}/docs`} className={linkClass}>
                  Docs
                </a>
                <a href={`${diffsExternal}/playground`} className={linkClass}>
                  Playground
                </a>
                <a href={`${diffsExternal}/theme`} className={linkClass}>
                  Theme
                </a>
              </>
            ) : (
              <>
                <Link href="/" className={linkClass}>
                  Home
                </Link>
                <Link href="/docs" className={linkClass}>
                  Docs
                </Link>
                <Link href="/playground" className={linkClass}>
                  Playground
                </Link>
                <Link href="/theme" className={linkClass}>
                  Theme
                </Link>
              </>
            )}
          </nav>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">Trees</h4>
          <nav className="flex flex-col gap-1">
            {isTrees ? (
              <>
                <Link
                  href={
                    PRODUCTS.trees.basePath !== ''
                      ? PRODUCTS.trees.basePath
                      : '/'
                  }
                  className={linkClass}
                >
                  Home
                </Link>
                <Link href={PRODUCTS.trees.docsPath} className={linkClass}>
                  Docs
                </Link>
              </>
            ) : (
              <>
                <a href={treesExternal} className={linkClass}>
                  Home
                </a>
                <a href={`${treesExternal}/docs`} className={linkClass}>
                  Docs
                </a>
              </>
            )}
          </nav>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">Community</h4>
          <nav className="flex flex-col gap-1">
            <Link
              href="https://x.com/pierrecomputer"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              X
            </Link>
            <Link
              href="https://discord.gg/pierre"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              Discord
            </Link>
            <Link
              href="https://github.com/pierrecomputer/pierre"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              GitHub
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
