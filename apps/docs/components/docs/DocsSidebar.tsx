'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { BetaBadge } from '@/components/BetaBadge';
import { MobileNavLink } from '@/components/MobileNavLink';
import NavLink from '@/components/NavLink';
import {
  DIFFS_THEME_PATH,
  getExternalUrl,
  getProductFromPathname,
  PRODUCTS,
} from '@/lib/product-config';

const siteProduct = process.env.NEXT_PUBLIC_SITE ?? 'diffs';
const isTrees = siteProduct === 'trees';

interface DocsSidebarProps {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface HeadingItem {
  id: string;
  text: string;
  level: number;
  element: HTMLElement;
  isBeta: boolean;
}

// Read a heading's label without the permalink anchor or any Beta badge that a
// React-managed heading may render, so the sidebar shows clean text (e.g.
// "Editor" rather than "EditorBeta") and can mirror the badge separately.
function getHeadingLabel(element: HTMLElement): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
    } else if (
      node instanceof HTMLElement &&
      !node.hasAttribute('data-heading-badge') &&
      !node.classList.contains('heading-anchor')
    ) {
      text += node.textContent ?? '';
    }
  }
  return text.trim();
}

export function DocsSidebar({
  isMobileOpen = false,
  onMobileClose,
}: DocsSidebarProps) {
  const pathname = usePathname();
  const product = getProductFromPathname(pathname);
  const navRef = useRef<HTMLElement>(null);

  // Mirror the desktop nav's active treatment: home matches exactly, while
  // section links (Edit, Docs, Theme) match their path prefix.
  const homePath = product.basePath !== '' ? product.basePath : '/';
  const isActivePath = (target: string) =>
    target === homePath ? pathname === target : pathname.startsWith(target);
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

      const text = getHeadingLabel(element);
      const level = parseInt(element.tagName.charAt(1));
      const id = element.id;
      const isBeta = element.querySelector('[data-heading-badge]') != null;

      headingItems.push({
        id,
        text,
        level,
        element,
        isBeta,
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
        className={`mobile-popover docs-sidebar ${isMobileOpen ? 'is-open' : ''}`}
        onClick={onMobileClose}
      >
        {isMobileOpen && (
          <div className="border-border mb-4 border-b pb-4 md:hidden">
            <MobileNavLink href={homePath} active={isActivePath(homePath)}>
              Home
            </MobileNavLink>
            {product.id === 'diffs' && (
              <MobileNavLink
                href={`${product.basePath}/edit`}
                active={isActivePath(`${product.basePath}/edit`)}
              >
                Edit
              </MobileNavLink>
            )}
            <MobileNavLink
              href={product.docsPath}
              active={isActivePath(product.docsPath)}
            >
              Docs
            </MobileNavLink>
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
            <MobileNavLink
              href={
                isTrees
                  ? `${getExternalUrl('diffs')}${DIFFS_THEME_PATH}`
                  : DIFFS_THEME_PATH
              }
              external={isTrees}
              active={!isTrees && isActivePath(DIFFS_THEME_PATH)}
            >
              Theme
            </MobileNavLink>
          </div>
        )}
        {headings.map((heading) => (
          <NavLink
            key={heading.id}
            href={`#${heading.id}`}
            active={activeHeading === heading.id}
            className={`mr-[2px] ${heading.level === 3 ? 'ml-4' : ''}`}
          >
            {heading.isBeta ? (
              <span className="inline-flex items-center gap-1.5">
                {heading.text}
                <BetaBadge className="px-1.5 py-px text-[10px] tracking-normal" />
              </span>
            ) : (
              heading.text
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export default DocsSidebar;
