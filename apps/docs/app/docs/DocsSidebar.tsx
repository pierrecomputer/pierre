'use client';

import { IconArrowUpRightCircle } from '@pierre/icons';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import NavLink from '../../components/NavLink';
import {
  getExternalUrl,
  getProductFromPathname,
  PRODUCTS,
} from '@/app/product-config';
import { cn } from '@/lib/utils';

const siteProduct = process.env.NEXT_PUBLIC_SITE ?? 'diffs';
const isTrees = siteProduct === 'trees';

function MobileNavLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'text-foreground flex items-center gap-1.5 rounded-md px-3 py-2 text-base transition-colors',
        'hover:bg-muted active:bg-muted/70'
      )}
    >
      {children}
      {external === true && (
        <IconArrowUpRightCircle className="text-muted-foreground" />
      )}
    </Link>
  );
}

interface DocsSidebarProps {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface HeadingItem {
  id: string;
  text: string;
  level: number;
  element: HTMLElement;
}

export function DocsSidebar({
  isMobileOpen = false,
  onMobileClose,
}: DocsSidebarProps) {
  const pathname = usePathname();
  const product = getProductFromPathname(pathname);
  const navRef = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeHeading, setActiveHeading] = useState<string>('');

  // Extract headings from the page content
  // IDs are set server-side by rehype-hierarchical-slug during MDX compilation
  useLayoutEffect(() => {
    const headingElements = document.querySelectorAll('h2[id], h3[id]');
    const headingItems: HeadingItem[] = [];

    for (const element of headingElements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      const text = element.textContent ?? '';
      const level = parseInt(element.tagName.charAt(1));
      const id = element.id;

      headingItems.push({
        id,
        text,
        level,
        element,
      });
    }

    setHeadings(headingItems);

    // Set first heading as active by default
    if (headingItems.length > 0 && window.location.hash.trim() === '') {
      setActiveHeading(headingItems[0].id);
    }

    // Scroll to hash if present
    if (window.location.hash.trim() !== '') {
      const id = window.location.hash.slice(1);
      const element = document.getElementById(id);
      if (element != null) {
        element.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    }
  }, []);

  // Handle scroll-based active heading detection
  useEffect(() => {
    const handleScroll = () => {
      let foundActive = false;

      for (let i = headings.length - 1; i >= 0; i--) {
        const heading = headings[i];
        const rect = heading.element.getBoundingClientRect();
        if (rect.top <= 100) {
          setActiveHeading(heading.id);
          foundActive = true;
          break;
        }
      }

      // If no heading is active, default to the first one
      if (!foundActive && headings.length > 0) {
        setActiveHeading(headings[0].id);
      }
    };

    if (headings.length > 0) {
      window.addEventListener('scroll', handleScroll);
      handleScroll(); // Check initial position

      return () => window.removeEventListener('scroll', handleScroll);
    }

    return undefined;
  }, [headings]);

  // Scroll active nav link into view within the sidebar
  useEffect(() => {
    const nav = navRef.current;
    if (activeHeading === '' || nav == null) {
      return;
    }

    const activeLink = nav.querySelector(
      `a[href="#${CSS.escape(activeHeading)}"]`
    );

    if (activeLink instanceof HTMLElement) {
      // Calculate position to center the link within the sidebar
      const linkTop = activeLink.offsetTop;
      const linkHeight = activeLink.offsetHeight;
      const navHeight = nav.clientHeight;
      const scrollTarget = linkTop - navHeight / 2 + linkHeight / 2;

      nav.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    }
  }, [activeHeading]);

  return (
    <>
      {isMobileOpen && (
        <div
          className="bg-background/50 fixed inset-0 z-[50] backdrop-blur-sm transition-opacity duration-200 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <nav
        ref={navRef}
        className={`docs-sidebar ${isMobileOpen ? 'is-open' : ''}`}
        onClick={onMobileClose}
      >
        {isMobileOpen && (
          <div className="border-border mb-4 border-b pb-4 md:hidden">
            <MobileNavLink
              href={product.basePath !== '' ? product.basePath : '/'}
            >
              Home
            </MobileNavLink>
            <MobileNavLink href={product.docsPath}>Docs</MobileNavLink>
            {product.themePath != null && (
              <MobileNavLink href={product.themePath}>Theme</MobileNavLink>
            )}
            {product.id === 'diffs' && (
              <MobileNavLink
                href={
                  isTrees ? PRODUCTS.trees.basePath : getExternalUrl('trees')
                }
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
          </div>
        )}
        {headings.map((heading) => (
          <NavLink
            key={heading.id}
            href={`#${heading.id}`}
            active={activeHeading === heading.id}
            className={`mr-[2px] ${heading.level === 3 ? 'ml-4' : ''}`}
          >
            {heading.text}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export default DocsSidebar;
