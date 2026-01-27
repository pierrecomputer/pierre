'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';

import { IconArrowUpRight } from './icons';
import { cn } from '@/lib/utils';

interface NavLinkProps {
  href: string;
  children: ReactNode;
  icon?: ReactNode;
  external?: boolean;
  active?: boolean;
  className?: string;
}

const NavLink = ({
  href,
  children,
  icon,
  external = false,
  active,
  className,
}: NavLinkProps) => {
  const pathname = usePathname();
  const isActive =
    active ??
    (pathname === href || (href !== '/' && pathname.startsWith(href)));

  const baseClasses = cn(
    // Base styles
    'flex items-center gap-2 px-3 py-[6px] rounded-md text-sm transition-all duration-150 ease-in-out cursor-pointer',
    'text-muted-foreground',
    // Hover states
    'hover:text-foreground',
    // Active states
    isActive && 'text-foreground bg-muted font-medium',
    className
  );

  // Apparently NextJS's Link tag doesn't support # links... lol
  if (external || href[0] === '#') {
    return (
      <a
        href={href}
        className={baseClasses}
        {...(external && { target: '_blank', rel: 'noopener noreferrer' })}
      >
        {icon != null && (
          <span className="flex h-4 w-4 items-center justify-center">
            {icon}
          </span>
        )}
        {external ? <span className="flex-1">{children}</span> : children}
        {external && <IconArrowUpRight color="fg4" />}
      </a>
    );
  }

  return (
    <Link href={href} className={baseClasses} prefetch>
      {icon != null && (
        <span className="flex h-4 w-4 items-center justify-center">{icon}</span>
      )}
      {children}
    </Link>
  );
};

export default NavLink;
