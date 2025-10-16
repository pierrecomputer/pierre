'use client';

import Footer from '@/components/Footer';
import { useEffect, useState } from 'react';

import { CompleteExample } from './CompleteExample';
import { ComponentProps } from './ComponentProps';
import { DocsHeader } from './DocsHeader';
import { EventHandlers } from './EventHandlers';
import { Installation } from './Installation';
import { Overview } from './Overview';
import { ReactAPI } from './ReactAPI';
import { RendererOptions } from './RendererOptions';
import { Styling } from './Styling';
import { TypescriptSupport } from './TypescriptSupport';
import { VanillaAPI } from './VanillaAPI';

export default function DocsPage() {
  const [isMobileMenuOpen] = useState(false);

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
      <DocsHeader />
      <div className="docs-container prose dark:prose-invert max-w-none">
        <Installation />
        <Overview />
        <ReactAPI />
        <VanillaAPI />
        <ComponentProps />
        <RendererOptions />
        <EventHandlers />
        <CompleteExample />
        <Styling />
        <TypescriptSupport />
      </div>
      <Footer />
    </div>
  );
}
