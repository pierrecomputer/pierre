'use client';

import { Header } from '@/components/Header';
import { type ReactNode, useEffect, useState } from 'react';

import { ExamplesSidebar } from './ExamplesSidebar';

export interface ExamplesLayoutProps {
  children: ReactNode;
}

export function ExamplesLayout({ children }: ExamplesLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen((prev) => !prev);
  };

  const handleMobileMenuClose = () => {
    setIsMobileMenuOpen(false);
  };

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }

    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [isMobileMenuOpen]);

  return (
    <>
      <Header
        onMobileMenuToggle={handleMobileMenuToggle}
        className="-mb-[1px]"
      />
      <div className="relative gap-6 pt-6 md:grid md:grid-cols-[180px_1fr] md:gap-10">
        <ExamplesSidebar
          isMobileOpen={isMobileMenuOpen}
          onMobileClose={handleMobileMenuClose}
        />
        {children}
      </div>
    </>
  );
}
