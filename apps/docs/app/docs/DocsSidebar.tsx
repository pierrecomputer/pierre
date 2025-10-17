import { useEffect, useState } from 'react';

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
  useEffect(() => {
    const extractHeadings = () => {
      const headingElements = document.querySelectorAll('h2, h3');
      const headingItems: HeadingItem[] = [];

      headingElements.forEach((element) => {
        const text = element.textContent ?? '';
        const id = generateId(text);
        const level = parseInt(element.tagName.charAt(1));

        // Set the ID on the element for anchor linking
        element.id = id;

        headingItems.push({
          id,
          text,
          level,
          element: element as HTMLElement,
        });
      });

      setHeadings(headingItems);
    };

    // Extract headings after a short delay to ensure DOM is ready
    const timeoutId = setTimeout(extractHeadings, 100);

    return () => clearTimeout(timeoutId);
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
        className={`
        p-5
        md:px-0
        md:relative md:py-7 md:block md:transform-none md:transition-none
        md:shadow-none md:border-none md:bg-transparent md:z-auto
        md:left-auto md:top-auto md:h-auto md:w-auto md:overflow-visible
        md:translate-x-0 md:opacity-100 md:pointer-events-auto

        fixed top-0 left-0 z-50 w-72 h-screen
        bg-background border-r border-border
        transform -translate-x-full transition-transform duration-300 ease-in-out
        overflow-y-auto shadow-xl
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
      `}
      >
        <nav className="sticky top-0 py-5 space-y-0.5" onClick={onMobileClose}>
          {headings.map((heading) => (
            <NavLink
              key={heading.id}
              href={`#${heading.id}`}
              active={activeHeading === heading.id}
              className={heading.level === 3 ? 'ml-4' : ''}
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
