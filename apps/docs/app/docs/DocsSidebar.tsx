'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import NavLink from '../../components/NavLink';

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
