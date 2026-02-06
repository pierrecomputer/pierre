'use client';

import {
  IconBrandDiscord,
  IconBrandGithub,
  IconChevronFlat,
  IconParagraph,
} from '@pierre/icons';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from './ui/button';
import { cn } from '@/lib/utils';

export interface HeaderProps {
  onMobileMenuToggle?: () => void;
  className?: string;
}

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
}

function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className={cn(
        'text-muted-foreground font-norma3 px-2',
        isActive(href) &&
          (href === '/' ? pathname === '/' : true) &&
          'text-foreground pointer-events-none font-medium'
      )}
    >
      <Link href={href}>{children}</Link>
    </Button>
  );
}

interface IconLinkProps {
  href: string;
  label: string;
  children: React.ReactNode;
}

function IconLink({ href, label, children }: IconLinkProps) {
  return (
    <Button variant="ghost" size="icon" asChild>
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
      >
        {children}
      </Link>
    </Button>
  );
}

export function Header({ onMobileMenuToggle, className }: HeaderProps) {
  const pathname = usePathname();
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    let lastStuck: boolean | undefined;
    const handleScroll = () => {
      const isStuck = window.scrollY > 0;
      if (isStuck !== lastStuck) {
        lastStuck = isStuck;
        setIsStuck(isStuck);
      }
    };

    // Check initial state
    handleScroll();

    // Update on scroll
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      data-slot="header"
      className={cn(
        'bg-background sticky top-0 z-40 flex items-center justify-between gap-4 py-3 transition-[border-color,box-shadow] duration-200',
        isStuck ? 'is-stuck' : 'border-b border-transparent',
        className
      )}
    >
      <Link
        href="/"
        className="text-foreground hover:text-foreground/80 flex items-center gap-2 transition-colors"
      >
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg leading-[20px] font-semibold">Diffs</span>
          <small className="text-muted-foreground hidden text-sm leading-[20px] md:inline">
            by The Pierre Computer Co.
          </small>
        </div>
      </Link>

      {(pathname === '/docs' || pathname === '/theme') && (
        <div className="mr-auto flex items-center gap-1 md:hidden">
          <IconChevronFlat size={16} className="text-border" />
          <Button variant="ghost" size="icon" onClick={onMobileMenuToggle}>
            <IconParagraph />
          </Button>
        </div>
      )}

      <nav className="flex items-center">
        <NavLink href="/">Home</NavLink>
        <NavLink href="/docs">Docs</NavLink>
        <NavLink href="/theme">Theme</NavLink>

        <div className="border-border mx-2 h-5 w-px border-l" />

        <IconLink href="https://discord.gg/pierre" label="Discord">
          <IconBrandDiscord />
        </IconLink>

        <IconLink
          href="https://github.com/pierrecomputer/pierre"
          label="GitHub"
        >
          <IconBrandGithub />
        </IconLink>
      </nav>
    </header>
  );
}
