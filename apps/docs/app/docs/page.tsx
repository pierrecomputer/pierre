'use client';

import Footer from '@/components/Footer';
import { Header } from '@/components/ui/header';
import { useEffect, useState } from 'react';

import DocsSidebar from '../../components/DocsSidebar';
import MobileMenuButton from '../../components/MobileMenuButton';

// import '../css/index.css';

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
    <div className="min-h-screen w-5xl px-5 mx-auto">
      <Header
        logo={
          <Header.Logo
            href="/"
            subtitle={
              <>
                by{' '}
                <span className="font-normal uppercase">
                  The Pierre Computer Company
                </span>
              </>
            }
          >
            Precision Diffs
          </Header.Logo>
        }
      >
        <Header.Nav>
          <Header.NavLink href="/">Home</Header.NavLink>
          <Header.NavLink href="/docs">Docs</Header.NavLink>
          <Header.NavLink href="https://discord.gg/pierre" external>
            Discord
          </Header.NavLink>
          <Header.NavLink href="https://github.com/pierreco/" external>
            GitHub
          </Header.NavLink>
        </Header.Nav>
      </Header>

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

      <Footer />
    </div>
  );
}
