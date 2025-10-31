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
        'flex flex-col justify-between border-b py-6 md:flex-row md:items-start',
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
        'text-foreground hover:text-foreground/80 flex gap-2 transition-colors',
        className
      )}
      {...props}
    >
      {/* <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="40"
        fill="none"
        viewBox="0 0 16 32"
      >
        <path
          fill="currentcolor"
          fill-rule="evenodd"
          d="M0 15.5V3a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v12.5H0ZM12 8a1 1 0 0 0-1-1H9V5a1 1 0 0 0-2 0v2H5a1 1 0 0 0 0 2h2v2a1 1 0 1 0 2 0V9h2a1 1 0 0 0 1-1Z"
          clip-rule="evenodd"
        />
        <path
          fill="currentcolor"
          fill-rule="evenodd"
          d="M16 29a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V16.5h16V29Zm-4-5a1 1 0 0 0-1-1H5a1 1 0 1 0 0 2h6a1 1 0 0 0 1-1Z"
          clip-rule="evenodd"
          opacity=".3"
        />
      </svg> */}
      <div className="flex flex-col">
        <span className="text-lg leading-[20px] font-semibold">{children}</span>
        {subtitle != null && (
          <small className="text-muted-foreground text-xs leading-[20px]">
            {subtitle}
          </small>
        )}
      </div>
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
      <NavigationMenuLink
        href={hrefString}
        className={cn(
          navigationMenuTriggerStyle(),
          'text-muted-foreground h-auto bg-transparent px-0 py-1.5 font-normal md:-mt-1.5',
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
