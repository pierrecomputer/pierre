'use client';

import NavLink from '@/components/NavLink';
import { useEffect, useState } from 'react';

interface ExamplesSidebarProps {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

const EXAMPLES = [
  { id: 'theme-carousel', label: 'Theme Carousel' },
  { id: 'custom-chrome', label: 'Custom Chrome' },
  { id: 'hover-actions', label: 'Hover Actions' },
  { id: 'ai-code-review', label: 'AI Code Review' },
  { id: 'pr-review', label: 'PR Review' },
  { id: 'git-blame', label: 'Git Blame' },
] as const;

export function ExamplesSidebar({
  isMobileOpen = false,
  onMobileClose,
}: ExamplesSidebarProps) {
  const [activeSection, setActiveSection] = useState<string>(EXAMPLES[0].id);

  useEffect(() => {
    const handleScroll = () => {
      // Find the section that's currently in view
      for (let i = EXAMPLES.length - 1; i >= 0; i--) {
        const example = EXAMPLES[i];
        const element = document.getElementById(example.id);
        if (element) {
          const rect = element.getBoundingClientRect();
          if (rect.top <= 120) {
            setActiveSection(example.id);
            return;
          }
        }
      }
      // Default to first section
      setActiveSection(EXAMPLES[0].id);
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Handle initial hash
  useEffect(() => {
    if (window.location.hash) {
      const id = window.location.hash.slice(1);
      const element = document.getElementById(id);
      if (element) {
        setActiveSection(id);
        element.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    }
  }, []);

  return (
    <>
      {isMobileOpen && (
        <div
          className="bg-background/50 fixed inset-0 z-[50] backdrop-blur-sm transition-opacity duration-200 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <nav
        className={`docs-sidebar ${isMobileOpen ? 'is-open' : ''}`}
        onClick={onMobileClose}
      >
        {EXAMPLES.map((example) => (
          <NavLink
            key={example.id}
            href={`#${example.id}`}
            active={activeSection === example.id}
          >
            {example.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
