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
      <div className="from-background sticky top-[60px] z-50 bg-linear-to-b to-transparent md:hidden">
        <Button
          variant="outline"
          onClick={toggleMobileMenu}
          className="bg-background dark:bg-background hover:bg-muted dark:hover:bg-muted w-full shadow-[0_2px_4px_rgba(0,0,0,0.05)]"
        >
          <IconParagraph />
          Jump to…
        </Button>
      </div>
      <div className="gap-6 md:grid md:grid-cols-[220px_1fr] md:gap-12">
        <DocsSidebar
          isMobileOpen={isMobileMenuOpen}
          onMobileClose={closeMobileMenu}
        />
      </div>
    </>
  );
}
