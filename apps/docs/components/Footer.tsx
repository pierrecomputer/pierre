'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { getProductFromPathname } from '@/app/product-config';

export default function Footer() {
  const pathname = usePathname();
  const product = getProductFromPathname(pathname);
  const homeHref = product.basePath !== '' ? product.basePath : '/';

  return (
    <footer className="pt-12 pb-12">
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-sm">{product.name}</div>
        <nav className="flex items-center gap-4">
          <Link
            href={homeHref}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Home
          </Link>
          <Link
            href={product.docsPath}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Docs
          </Link>
          <Link
            href={product.themePath}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Theme
          </Link>
        </nav>
      </div>
    </footer>
  );
}
