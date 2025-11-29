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
    const headingElements = document.querySelectorAll('h2, h3, h4');
    const headingItems: HeadingItem[] = [];

    for (const element of headingElements) {
      if (!(element instanceof HTMLElement) || 'tocIgnore' in element.dataset) {
        continue;
      }
      const text = element.textContent ?? '';
      const id = generateId(text);
      const level = parseInt(element.tagName.charAt(1));

      // Set the ID on the element for anchor linking
      element.id = id;

      headingItems.push({
        id,
        text,
        level,
        element: element,
      });
    }

    setHeadings(headingItems);

    // After setting IDs, scroll to hash if present (browser couldn't do it earlier)
    if (window.location.hash.trim() !== '') {
      const id = window.location.hash.slice(1);
      const element = document.getElementById(id);
      if (element != null) {
        element.scrollIntoView();
      }
    }
  }, []);

  // Handle scroll-based active heading detection
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 100; // Offset for better UX

      for (let i = headings.length - 1; i >= 0; i--) {
        const heading = headings[i];
        if (heading.element.offsetTop <= scrollPosition) {
          setActiveHeading(heading.id);
          break;
        }
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
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={`bg-background border-border fixed top-0 left-0 z-50 h-screen w-72 -translate-x-full transform overflow-y-auto border-r p-5 shadow-xl transition-transform duration-300 ease-in-out md:pointer-events-auto md:relative md:top-auto md:left-auto md:z-auto md:block md:h-auto md:w-auto md:translate-x-0 md:transform-none md:overflow-visible md:border-none md:bg-transparent md:px-0 md:py-7 md:opacity-100 md:shadow-none md:transition-none ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} `}
      >
        <nav className="sticky top-0 space-y-0.5 py-5" onClick={onMobileClose}>
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
