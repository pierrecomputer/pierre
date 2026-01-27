'use client';

import { type ReactNode, useState } from 'react';

import { SidebarWrapper } from '../docs/SidebarWrapper';
import { Header } from '@/components/Header';

export interface ThemeLayoutProps {
  /** Content rendered full-width above the sidebar grid (hero, demo, etc.) */
  header?: ReactNode;
  /** Content rendered in the main column next to the sidebar */
  children: ReactNode;
}

/**
 * Layout for the /theme page with full-width header sections
 * and a sidebar grid for documentation content.
 */
export function ThemeLayout({ header, children }: ThemeLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen((prev) => !prev);
  };

  const handleMobileMenuClose = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      <Header
        onMobileMenuToggle={handleMobileMenuToggle}
        className="-mb-[1px]"
      />

      {header}

      <div className="relative gap-6 pt-6 md:grid md:grid-cols-[220px_1fr] md:gap-12">
        <SidebarWrapper
          isMobileMenuOpen={isMobileMenuOpen}
          onMobileMenuClose={handleMobileMenuClose}
        />
        {children}
      </div>
    </>
  );
}
