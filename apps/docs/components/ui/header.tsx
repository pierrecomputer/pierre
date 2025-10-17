'use client';

import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { IconArrowUpRight } from '../icons';
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

function Header({ className, logo, children, ...props }: HeaderProps) {
  return (
    <header
      data-slot="header"
      className={cn(
        'flex flex-col md:flex-row md:items-center justify-between py-6 border-b ',
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
      {subtitle != null && (
        <small className="text-xs text-muted-foreground">{subtitle}</small>
      )}
    </Link>
  );
}

function HeaderNav({ className, children, ...props }: HeaderNavProps) {
  return (
    /* @ts-expect-error Todo: Alex type check this */
    <NavigationMenu className={className} {...props}>
      <NavigationMenuList>{children}</NavigationMenuList>
    </NavigationMenu>
  );
}

function HeaderNavLink({
  className,
  active,
  external = false,
  children,
  href,
  ...props
}: HeaderNavLinkProps) {
  const pathname = usePathname();
  const hrefString = href?.toString() ?? '';

  // Auto-detect active state if not explicitly provided
  const isActive =
    active ??
    (hrefString === pathname ||
      (hrefString !== '/' ? pathname.startsWith(hrefString) : false));

  return (
    <NavigationMenuItem>
      {/* @ts-expect-error todo: Alex type check this */}
      <NavigationMenuLink
        href={hrefString}
        className={cn(
          navigationMenuTriggerStyle(),
          'h-auto py-1.5 px-0 text-muted-foreground font-normal bg-transparent',
          isActive && 'text-accent-foreground font-medium',
          external && 'inline-flex items-center gap-[2px]',
          className
        )}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        {...props}
      >
        {children}
        {external && <IconArrowUpRight />}
      </NavigationMenuLink>
    </NavigationMenuItem>
  );
}

Header.Logo = HeaderLogo;
Header.Nav = HeaderNav;
Header.NavLink = HeaderNavLink;

export { Header, HeaderLogo, HeaderNav, HeaderNavLink };
