'use client';

import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from './navigation-menu';

interface HeaderProps extends React.HTMLAttributes<HTMLElement> {
  logo?: React.ReactNode;
  logoHref?: string;
  children?: React.ReactNode;
}

interface HeaderNavProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
}

interface HeaderNavLinkProps extends React.ComponentProps<typeof Link> {
  active?: boolean;
  external?: boolean;
  children?: React.ReactNode;
}

interface HeaderLogoProps extends React.ComponentProps<typeof Link> {
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}

function Header({
  className,
  logo,
  logoHref = '/',
  children,
  ...props
}: HeaderProps) {
  return (
    <header
      data-slot="header"
      className={cn(
        'flex items-center justify-between px-8 py-6 border-b ',
        className
      )}
      {...props}
    >
      {logo}
      {children}
    </header>
  );
}

function HeaderLogo({
  className,
  subtitle,
  children,
  ...props
}: HeaderLogoProps) {
  return (
    <Link
      data-slot="header-logo"
      className={cn(
        'flex flex-col leading-tight text-foreground hover:text-foreground/80 transition-colors',
        className
      )}
      {...props}
    >
      <span className="text-lg font-semibold">{children}</span>
      {subtitle && (
        <small className="text-xs text-muted-foreground">{subtitle}</small>
      )}
    </Link>
  );
}

function HeaderNav({ className, children, ...props }: HeaderNavProps) {
  return (
    <NavigationMenu className={className} {...props}>
      <NavigationMenuList>{children}</NavigationMenuList>
    </NavigationMenu>
  );
}

function HeaderNavLink({
  className,
  active,
  external,
  children,
  href,
  ...props
}: HeaderNavLinkProps) {
  const pathname = usePathname();
  const hrefString = href?.toString() || '';

  // Auto-detect active state if not explicitly provided
  const isActive =
    active !== undefined
      ? active
      : hrefString === pathname ||
        (hrefString !== '/' && pathname.startsWith(hrefString));

  return (
    <NavigationMenuItem>
      <NavigationMenuLink
        href={hrefString}
        className={cn(
          navigationMenuTriggerStyle(),
          'h-auto py-1.5 px-3',
          isActive && 'bg-accent/50 text-accent-foreground',
          external && 'inline-flex items-center gap-1',
          className
        )}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        {...props}
      >
        {children}
        {external && (
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 16 16"
            stroke="currentColor"
          >
            <path
              d="M5.75 3.25H12.25V9.75M12.25 3.25L3.25 12.25"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </NavigationMenuLink>
    </NavigationMenuItem>
  );
}

Header.Logo = HeaderLogo;
Header.Nav = HeaderNav;
Header.NavLink = HeaderNavLink;

export { Header, HeaderLogo, HeaderNav, HeaderNavLink };
