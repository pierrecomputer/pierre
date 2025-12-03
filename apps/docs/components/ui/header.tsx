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
        'text-foreground hover:text-foreground/80 flex items-center gap-2 transition-colors',
        className
      )}
      {...props}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg leading-[20px] font-semibold">{children}</span>
        {subtitle != null && (
          <small className="text-muted-foreground hidden text-sm leading-[20px] md:inline">
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
          'text-muted-foreground h-auto bg-transparent px-0 py-1.5 leading-[20px] font-normal',
          isActive && 'text-accent-foreground font-medium',
          external && 'inline-flex items-center gap-[2px]',
          className
        )}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        {...props}
      >
        {children}
      </NavigationMenuLink>
    </NavigationMenuItem>
  );
}

const HeaderRoot = React.forwardRef<HTMLElement, HeaderProps>(
  ({ className, logo, children, ...props }, ref) => {
    return (
      <header
        ref={ref}
        data-slot="header"
        className={cn(
          'bg-background sticky top-0 z-40 flex justify-between gap-4 py-4 transition-[padding,box-shadow] duration-200 md:flex-row md:items-center',
          className
        )}
        {...props}
      >
        {logo}
        {children}
      </header>
    );
  }
);
HeaderRoot.displayName = 'Header';

const Header = Object.assign(HeaderRoot, {
  Logo: HeaderLogo,
  Nav: HeaderNav,
  NavLink: HeaderNavLink,
});

export { Header, HeaderLogo, HeaderNav, HeaderNavLink };
