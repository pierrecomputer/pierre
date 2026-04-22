'use client';

import { useEffect } from 'react';

import { MobileNavLink } from './MobileNavLink';
import {
  DIFFS_THEME_PATH,
  getExternalUrl,
  type ProductConfig,
  PRODUCTS,
} from '@/app/product-config';

const siteProduct = process.env.NEXT_PUBLIC_SITE ?? 'diffs';
const isTrees = siteProduct === 'trees';

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
        <MobileNavLink href={product.docsPath}>Docs</MobileNavLink>
        {product.themePath != null && (
          <MobileNavLink href={product.themePath}>Theme</MobileNavLink>
        )}
        {product.id === 'diffs' && (
          <MobileNavLink
            href={isTrees ? PRODUCTS.trees.basePath : getExternalUrl('trees')}
            external={!isTrees}
          >
            Trees
          </MobileNavLink>
        )}
        {product.id === 'trees' && (
          <MobileNavLink
            href={isTrees ? getExternalUrl('diffs') : '/'}
            external={isTrees}
          >
            Diffs
          </MobileNavLink>
        )}
        <MobileNavLink
          href={
            isTrees
              ? `${getExternalUrl('diffs')}${DIFFS_THEME_PATH}`
              : DIFFS_THEME_PATH
          }
          external={isTrees}
        >
          Theme
        </MobileNavLink>
      </nav>
    </>
  );
}

export default HeaderMobileMenu;
