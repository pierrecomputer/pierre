'use client';

import { useEffect } from 'react';

import { DocsSidebar } from './DocsSidebar';

export interface SidebarWrapperProps {
  isMobileMenuOpen?: boolean;
  onMobileMenuClose?: () => void;
}

export function SidebarWrapper({
  isMobileMenuOpen = false,
  onMobileMenuClose,
}: SidebarWrapperProps) {
  // Prevent body scroll when mobile menu is open
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

  return (
    <DocsSidebar
      isMobileOpen={isMobileMenuOpen}
      onMobileClose={onMobileMenuClose}
    />
  );
}
