'use client';

import { useEffect, useState } from 'react';

import DocsSidebar from '../../components/DocsSidebar';
import Header from '../../components/Header';
import MobileMenuButton from '../../components/MobileMenuButton';
import '../css/index.css';

export default function DocsPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const handleMobileMenuClose = () => {
    setIsMobileMenuOpen(false);
  };

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.classList.add('mobile-menu-open');
    } else {
      document.body.classList.remove('mobile-menu-open');
    }

    // Cleanup on unmount
    return () => {
      document.body.classList.remove('mobile-menu-open');
    };
  }, [isMobileMenuOpen]);

  return (
    <div className="container">
      <Header />

      <div className="docs-container">
        <MobileMenuButton onClick={handleMobileMenuToggle} />

        <DocsSidebar
          isMobileOpen={isMobileMenuOpen}
          onMobileClose={handleMobileMenuClose}
        />
        <main className="docs-main">
          <h2>Install</h2>
        </main>
      </div>
    </div>
  );
}
