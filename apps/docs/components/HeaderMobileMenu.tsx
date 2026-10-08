'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { MobileNavLink } from './MobileNavLink';
import {
  DIFFS_THEME_PATH,
  getExternalUrl,
  type ProductConfig,
} from '@/lib/product-config';

const DIFFSHUB_URL = 'https://diffshub.com';

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
  const pathname = usePathname();

  // Mirror the desktop nav's active treatment: home matches exactly, while
  // section links (Edit, Highlights, Docs, Themes) match their path prefix.
  const homePath = product.basePath !== '' ? product.basePath : '/';
  const isActivePath = (target: string) =>
    target === homePath ? pathname === target : pathname.startsWith(target);
  const diffsUrl = getExternalUrl('diffs');
  const isDiffs = product.id === 'diffs';
  const otherProductId = isDiffs ? 'trees' : 'diffs';
  const otherProductName = isDiffs ? 'Trees' : 'Diffs';

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
        <MobileNavLink href={homePath} active={isActivePath(homePath)}>
          Home
        </MobileNavLink>
        {isDiffs && (
          <MobileNavLink
            href={`${product.basePath}/edit`}
            active={isActivePath(`${product.basePath}/edit`)}
          >
            Edit
          </MobileNavLink>
        )}
        {isDiffs && (
          <MobileNavLink
            href={`${product.basePath}/highlights`}
            active={isActivePath(`${product.basePath}/highlights`)}
          >
            Highlights
          </MobileNavLink>
        )}
        <MobileNavLink
          href={product.docsPath}
          active={isActivePath(product.docsPath)}
        >
          Docs
        </MobileNavLink>
        <div className="border-border my-1 border-t" />
        {isDiffs ? (
          <MobileNavLink
            href={`${product.basePath}${DIFFS_THEME_PATH}`}
            active={isActivePath(`${product.basePath}${DIFFS_THEME_PATH}`)}
          >
            Themes
          </MobileNavLink>
        ) : (
          <MobileNavLink href={`${diffsUrl}${DIFFS_THEME_PATH}`} external>
            Themes
          </MobileNavLink>
        )}
        {isDiffs ? (
          <MobileNavLink
            href={`${product.basePath}/icons`}
            active={isActivePath(`${product.basePath}/icons`)}
          >
            Icons
          </MobileNavLink>
        ) : (
          <MobileNavLink href={`${diffsUrl}/icons`} external>
            Icons
          </MobileNavLink>
        )}
        <MobileNavLink href={getExternalUrl(otherProductId)} external>
          {otherProductName}
        </MobileNavLink>
        <MobileNavLink href={DIFFSHUB_URL} external>
          DiffsHub
        </MobileNavLink>
      </nav>
    </>
  );
}

export default HeaderMobileMenu;
