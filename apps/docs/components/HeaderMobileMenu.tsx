'use client';

import { useEffect } from 'react';

import { MobileNavLink } from './MobileNavLink';
import {
  DIFFS_THEME_PATH,
  getExternalUrl,
  type ProductConfig,
  type ProductId,
  PRODUCTS,
} from '@/lib/product-config';

const siteProduct = process.env.NEXT_PUBLIC_SITE ?? 'diffs';
const isDiffs = siteProduct === 'diffs';

// Order matches Header.tsx so the desktop and mobile navs render the same
// list of cross-site links.
const OTHER_PRODUCT_IDS: ProductId[] = ['diffs', 'trees', 'diffshub'];

export interface HeaderMobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  product: ProductConfig;
}

/**
 * Self-contained mobile popover used by the Header on pages that don't
 * already render a docs-style sidebar (home, playground, ssr). On docs/theme
 * pages the DocsSidebar popover is used instead and includes a TOC section.
 */
export function HeaderMobileMenu({
  isOpen,
  onClose,
  product,
}: HeaderMobileMenuProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [isOpen]);

  return (
    <>
      {isOpen && (
        <div
          className="bg-background/50 fixed inset-0 z-[50] backdrop-blur-sm transition-opacity duration-200 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <nav
        className={`mobile-popover md:hidden ${isOpen ? 'is-open' : ''}`}
        onClick={onClose}
      >
        <MobileNavLink href={product.basePath !== '' ? product.basePath : '/'}>
          Home
        </MobileNavLink>
        {product.id !== 'diffshub' && (
          <MobileNavLink href={product.docsPath}>Docs</MobileNavLink>
        )}
        {product.themePath != null && (
          <MobileNavLink href={product.themePath}>Theme</MobileNavLink>
        )}
        {OTHER_PRODUCT_IDS.filter((id) => id !== product.id).map((id) => (
          <MobileNavLink key={id} href={getExternalUrl(id)} external>
            {PRODUCTS[id].name}
          </MobileNavLink>
        ))}
        {/* Theme lives only on the diffs site. From any other site, link out
            to it; on the diffs site itself we already rendered it above via
            `product.themePath`. */}
        {!isDiffs && (
          <MobileNavLink
            href={`${getExternalUrl('diffs')}${DIFFS_THEME_PATH}`}
            external
          >
            Theme
          </MobileNavLink>
        )}
      </nav>
    </>
  );
}

export default HeaderMobileMenu;
