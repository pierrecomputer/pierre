'use client';

import {
  IconArrowUpRight,
  IconBrandDiscord,
  IconBrandGithub,
  IconChevronFlat,
  IconChevronSm,
  IconParagraph,
} from '@pierre/icons';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { HeaderMobileMenu } from './HeaderMobileMenu';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  DIFFS_THEME_PATH,
  getExternalUrl,
  getProductFromPathname,
  type ProductConfig,
} from '@/lib/product-config';
import { cn } from '@/lib/utils';

const DIFFSHUB_URL = 'https://diffshub.com';

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

function ExternalNavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className="text-muted-foreground gap-0.5 px-2 font-normal"
    >
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <IconArrowUpRight />
      </a>
    </Button>
  );
}

function MoreMenu({
  pathname,
  product,
}: {
  pathname: string;
  product: ProductConfig;
}) {
  const diffsUrl = getExternalUrl('diffs');
  const themeHref =
    product.id === 'diffs'
      ? `${product.basePath}${DIFFS_THEME_PATH}`
      : `${diffsUrl}${DIFFS_THEME_PATH}`;
  const highlightsHref =
    product.id === 'diffs'
      ? `${product.basePath}/highlights`
      : `${diffsUrl}/highlights`;
  const iconsHref =
    product.id === 'diffs' ? `${product.basePath}/icons` : `${diffsUrl}/icons`;
  const isThemeActive =
    product.id === 'diffs' && pathname.startsWith(DIFFS_THEME_PATH);
  const isIconsActive = product.id === 'diffs' && pathname.startsWith('/icons');
  const isHighlightsActive =
    product.id === 'diffs' && pathname.startsWith('/highlights');
  const isMoreActive = isThemeActive || isIconsActive || isHighlightsActive;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'text-muted-foreground group gap-0.5 px-2 font-normal',
            isMoreActive && 'text-foreground font-medium'
          )}
        >
          More
          <IconChevronSm className="transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem
          asChild
          className="cursor-pointer"
          selected={isThemeActive}
        >
          {product.id === 'diffs' ? (
            <Link href={themeHref}>Themes</Link>
          ) : (
            <a href={themeHref} target="_blank" rel="noopener noreferrer">
              Themes
              <IconArrowUpRight className="ml-auto opacity-60" />
            </a>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild
          className="cursor-pointer"
          selected={isIconsActive}
        >
          {product.id === 'diffs' ? (
            <Link href={iconsHref}>Icons</Link>
          ) : (
            <a href={iconsHref} target="_blank" rel="noopener noreferrer">
              Icons
              <IconArrowUpRight className="ml-auto opacity-60" />
            </a>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild
          className="cursor-pointer"
          selected={isHighlightsActive}
        >
          {product.id === 'diffs' ? (
            <Link href={highlightsHref}>Highlights</Link>
          ) : (
            <a href={highlightsHref} target="_blank" rel="noopener noreferrer">
              Highlights
              <IconArrowUpRight className="ml-auto opacity-60" />
            </a>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="mx-1.5" />
        <DropdownMenuItem asChild className="cursor-pointer">
          <a href={DIFFSHUB_URL} target="_blank" rel="noopener noreferrer">
            DiffsHub
            <IconArrowUpRight className="ml-auto opacity-60" />
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const [internalMenuOpen, setInternalMenuOpen] = useState(false);
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
  // When no parent-managed handler is provided, the Header owns its own
  // mobile popover (used on home, playground, ssr). Docs/theme pages pass a
  // handler so the existing DocsSidebar popover can be opened instead.
  const ownsPopover = onMobileMenuToggle == null;
  const handleMobileToggle = ownsPopover
    ? () => setInternalMenuOpen((v) => !v)
    : onMobileMenuToggle;

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
          className="text-foreground hover:text-foreground/80 flex items-center gap-2 text-lg leading-[20px] font-semibold transition-colors"
        >
          {/* Product favicon, mirroring the per-site icon set in the layout. */}
          <img
            src={`/${product.id}-brand/icon.svg`}
            alt=""
            aria-hidden="true"
            width={24}
            height={24}
            className="hidden size-6 shrink-0"
          />
          {product.name}
        </Link>
      </div>

      <div className="mr-auto flex items-center gap-1 md:hidden">
        <IconChevronFlat size={16} className="text-border" />
        <Button
          variant="ghost"
          size="icon"
          onClick={handleMobileToggle}
          aria-label={
            ownsPopover ? 'Toggle navigation menu' : 'Toggle table of contents'
          }
        >
          <IconParagraph />
        </Button>
      </div>

      {ownsPopover && (
        <HeaderMobileMenu
          isOpen={internalMenuOpen}
          onClose={() => setInternalMenuOpen(false)}
          product={product}
        />
      )}

      <nav className="flex items-center">
        <div className="hidden items-center md:flex">
          <NavLink href="/" basePath={product.basePath}>
            Home
          </NavLink>
          {product.id === 'diffs' ? (
            <NavLink href="/edit" basePath={product.basePath}>
              Edit
            </NavLink>
          ) : (
            <ExternalNavLink href={getExternalUrl('diffs')}>
              Diffs
            </ExternalNavLink>
          )}
          {product.id === 'trees' ? (
            <NavLink href="/" basePath={product.basePath}>
              Trees
            </NavLink>
          ) : (
            <ExternalNavLink href={getExternalUrl('trees')}>
              Trees
            </ExternalNavLink>
          )}
          <NavLink href="/docs" basePath={product.basePath}>
            Docs
          </NavLink>
          <MoreMenu pathname={pathname} product={product} />

          <div className="border-border mx-2 h-5 w-px border-l" />
        </div>

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
