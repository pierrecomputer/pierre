'use client';

import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import { TreesDevSidebar } from './TreesDevSidebar';

/**
 * Client shell that wraps the sidebar and main content area,
 * handling the mobile hamburger menu toggle and backdrop.
 */
export function TreesDevShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    return () => document.body.classList.remove('overflow-hidden');
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen bg-neutral-50 dark:bg-neutral-900">
      {/* Mobile hamburger button */}
      <button
        type="button"
        className="bg-background fixed top-3 right-3 z-[60] rounded-md border p-1.5 md:hidden"
        style={{ borderColor: 'var(--color-border)' }}
        onClick={() => setMobileOpen((prev) => !prev)}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
      >
        {mobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="bg-background/50 fixed inset-0 z-[50] backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — always visible on desktop, slide-over on mobile */}
      <div
        className={`fixed top-0 left-0 z-[55] h-full w-[220px] shrink-0 transition-transform duration-200 md:relative md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <TreesDevSidebar onNavigate={() => setMobileOpen(false)} />
      </div>

      <main className="min-w-0 flex-1 p-6 pb-12">{children}</main>
    </div>
  );
}
