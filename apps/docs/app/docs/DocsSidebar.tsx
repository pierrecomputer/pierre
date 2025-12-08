'use client';

import { useEffect, useLayoutEffect, useState } from 'react';

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
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeHeading, setActiveHeading] = useState<string>('');

  // Generate ID from heading text
  const generateId = (text: string): string => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim();
  };

  // Extract headings from the page content
  useLayoutEffect(() => {
    const timeoutId = setTimeout(() => {
      const headingElements = document.querySelectorAll('h2, h3, h4');
      const headingItems: HeadingItem[] = [];

      // Track parent headings at each level for hierarchical IDs
      const parentIds: Record<number, string> = {};

      for (const element of headingElements) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }
        const text = element.textContent ?? '';
        const level = parseInt(element.tagName.charAt(1));
        const baseId = generateId(text);

        // Build hierarchical ID from parent headings
        let id = baseId;
        if (level > 2 && parentIds[level - 1] != null) {
          id = `${parentIds[level - 1]}-${baseId}`;
        }

        // Store this heading's ID for child headings
        parentIds[level] = id;
        // Clear child levels when we encounter a new parent
        for (let i = level + 1; i <= 4; i++) {
          delete parentIds[i];
        }

        // Set the ID on the element for anchor linking
        element.id = id;

        // Only add to sidebar if not ignored
        if (!('tocIgnore' in element.dataset)) {
          headingItems.push({
            id,
            text,
            level,
            element: element,
          });
        }
      }

      setHeadings(headingItems);

      // Set first heading as active by default
      if (headingItems.length > 0 && window.location.hash.trim() === '') {
        setActiveHeading(headingItems[0].id);
      }

      // After setting IDs, scroll to hash if present (browser couldn't do it earlier)
      if (window.location.hash.trim() !== '') {
        const id = window.location.hash.slice(1);
        const element = document.getElementById(id);
        if (element != null) {
          element.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
      }
    }, 100);
    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  // Handle scroll-based active heading detection
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 100; // Offset for better UX
      let foundActive = false;

      for (let i = headings.length - 1; i >= 0; i--) {
        const heading = headings[i];
        if (heading.element.offsetTop <= scrollPosition) {
          setActiveHeading(heading.id);
          foundActive = true;
          break;
        }
      }

      // If no heading is active (e.g., at the very top), default to the first one
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

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-[50] bg-black/30 backdrop-blur-sm transition-opacity duration-200 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={`bg-background fixed top-16 right-4 left-4 z-[60] max-h-[70vh] -translate-y-2 transform overflow-y-auto rounded-xl border border-[rgb(0_0_0_/_0.15)] bg-clip-padding p-4 opacity-0 shadow-2xl transition-all duration-200 ease-out md:pointer-events-auto md:relative md:top-auto md:right-auto md:left-auto md:z-auto md:block md:max-h-none md:translate-y-0 md:transform-none md:overflow-visible md:rounded-none md:border-none md:bg-transparent md:p-0 md:opacity-100 md:shadow-none md:transition-none ${isMobileOpen ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none'}`}
      >
        <nav
          className="max-h-[calc(100vh-65px)] overflow-y-auto pr-[2px] [scrollbar-color:transparent_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] hover:[scrollbar-color:auto] md:sticky md:top-22"
          onClick={onMobileClose}
        >
          {headings.map((heading) => (
            <NavLink
              key={heading.id}
              href={`#${heading.id}`}
              active={activeHeading === heading.id}
              className={
                heading.level === 3
                  ? 'ml-4'
                  : heading.level === 4
                    ? 'ml-8'
                    : undefined
              }
            >
              {heading.text}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}

export default DocsSidebar;
