'use client';

import Footer from '@/components/Footer';
import { IconParagraph } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

import { DocsHeader } from './DocsHeader';
import { DocsSidebar } from './DocsSidebar';
import { Installation } from './Installation';
import { Overview } from './Overview';
import { ReactAPI } from './ReactAPI';
import { Styling } from './Styling';
import { VanillaAPI } from './VanillaAPI';
import type { DocsExampleTypes } from './types';

export default function DocsPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [exampleTypes, setExampleType] = useState<DocsExampleTypes>('vanilla');

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

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="relative min-h-screen w-5xl px-5 mx-auto max-w-full">
      <DocsHeader />

      <Button
        variant="outline"
        onClick={toggleMobileMenu}
        className="md:hidden sticky top-5 z-50 mt-8 bg-background dark:bg-background hover:bg-muted dark:hover:bg-muted"
      >
        <IconParagraph />
        Menu
      </Button>

      <Button
        variant="outline"
        onClick={toggleMobileMenu}
        className="md:hidden sticky top-5 z-50 mt-8 bg-background dark:bg-background hover:bg-muted dark:hover:bg-muted"
      >
        <IconParagraph />
        Menu
      </Button>

      <div className="md:grid md:grid-cols-[220px_1fr] gap-6 md:gap-12">
        <DocsSidebar
          isMobileOpen={isMobileMenuOpen}
          onMobileClose={closeMobileMenu}
        />
        <div className="prose dark:prose-invert w-full min-w-0 max-w-full">
          <Installation />
          <Overview
            exampleType={exampleTypes}
            setExampleType={setExampleType}
          />
          <ReactAPI />
          <VanillaAPI />
          <Styling />
          {/* <ComponentProps /> */}
          {/* <RendererOptions /> */}
          {/* <EventHandlers /> */}
          {/* <CompleteExample /> */}
          {/* <TypescriptSupport /> */}
        </div>
      </div>
      <Footer />
    </div>
  );
}
