'use client';

import { IconParagraph } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

import { DocsSidebar } from './DocsSidebar';

export function SidebarWrapper() {
  // Prevent body scroll when mobile menu is open
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }

    // Cleanup on unmount
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [isMobileMenuOpen]);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={toggleMobileMenu}
        className="bg-background dark:bg-background hover:bg-muted dark:hover:bg-muted fixed top-5 right-5 z-50 md:hidden"
      >
        <IconParagraph />
        Menu
      </Button>
      <div className="gap-6 md:grid md:grid-cols-[220px_1fr] md:gap-12">
        <DocsSidebar
          isMobileOpen={isMobileMenuOpen}
          onMobileClose={closeMobileMenu}
        />
      </div>
    </>
  );
}
