'use client';

import { type ReactNode, useState } from 'react';

import { SidebarWrapper } from './SidebarWrapper';
import { Header } from '@/components/Header';

export interface DocsLayoutProps {
  children: ReactNode;
}

export function DocsLayout({ children }: DocsLayoutProps) {
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
