'use client';

import {
  IconArrowUpRight,
  IconBrandDiscord,
  IconBrandGithub,
  IconChevronFlat,
  IconParagraph,
} from '@pierre/icons';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from './ui/button';
import { getProductFromPathname } from '@/app/product-config';
import { cn } from '@/lib/utils';

export interface HeaderProps {
  onMobileMenuToggle?: () => void;
  className?: string;
}

interface NavLinkProps {
  href: string;
  basePath: string;
  children: React.ReactNode;
}

function NavLink({ href, basePath, children }: NavLinkProps) {
  const pathname = usePathname();
  const fullHref =
    href === '/' ? (basePath !== '' ? basePath : '/') : `${basePath}${href}`;

  const isActive = () => {
    if (href === '/') {
      return pathname === (basePath !== '' ? basePath : '/');
    }
    return pathname.startsWith(fullHref);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className={cn(
        'text-muted-foreground font-normal px-2 gap-0.5',
        isActive() && 'text-foreground pointer-events-none font-medium'
      )}
    >
      <Link href={fullHref}>{children}</Link>
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
  const product = getProductFromPathname(pathname);

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

  const homeHref = product.basePath !== '' ? product.basePath : '/';
  const showMobileMenu =
    pathname === product.docsPath ||
    (product.themePath != null && pathname === product.themePath);

  return (
    <header
      data-slot="header"
      className={cn(
        'bg-background bg-clip-padding sticky top-0 z-40 flex items-center justify-between gap-4 py-3 transition-[border-color,box-shadow] duration-200 px-5 -mx-5 md:mx-0 md:px-0',
        isStuck ? 'is-stuck' : 'border-b border-transparent',
        className
      )}
    >
      <div className="flex items-baseline gap-1.5">
        <Link
          href={homeHref}
          className="text-foreground hover:text-foreground/80 text-lg leading-[20px] font-semibold transition-colors"
        >
          {product.name}
        </Link>
        <span className="text-muted-foreground hidden text-sm leading-[20px] md:inline">
          by{' '}
          <Link
            href="https://pierre.computer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground/80 hidden text-sm leading-[20px] transition-colors md:inline"
          >
            The Pierre Computer Co.
          </Link>
        </span>
      </div>

      {showMobileMenu && (
        <div className="mr-auto flex items-center gap-1 md:hidden">
          <IconChevronFlat size={16} className="text-border" />
          <Button variant="ghost" size="icon" onClick={onMobileMenuToggle}>
            <IconParagraph />
          </Button>
        </div>
      )}

      <nav className="flex items-center">
        <NavLink href="/" basePath={product.basePath}>
          Home
        </NavLink>
        <NavLink href="/docs" basePath={product.basePath}>
          Docs
        </NavLink>
        {product.id === 'diffs' ? (
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-muted-foreground gap-0.5 px-2 font-normal"
          >
            <Link
              href="https://trees.software"
              target="_blank"
              rel="noopener noreferrer"
            >
              Trees
              <IconArrowUpRight />
            </Link>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-muted-foreground gap-0.5 px-2 font-normal"
          >
            <Link
              href="https://diffs.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Diffs
              <IconArrowUpRight />
            </Link>
          </Button>
        )}

        <div className="border-border mx-2 h-5 w-px border-l" />

        <IconLink href="https://discord.gg/pierre" label="Discord">
          <IconBrandDiscord />
        </IconLink>

        <IconLink href={product.githubUrl} label="GitHub">
          <IconBrandGithub />
        </IconLink>
      </nav>
    </header>
  );
}
