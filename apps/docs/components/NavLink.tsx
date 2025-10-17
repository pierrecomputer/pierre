'use client';

import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';

import { IconArrowUpRight } from './icons';

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

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={baseClasses}
      >
        {icon != null && (
          <span className="flex items-center justify-center w-4 h-4">
            {icon}
          </span>
        )}
        <span className="flex-1">{children}</span>
        <IconArrowUpRight color="fg4" />
      </a>
    );
  }

  return (
    <Link href={href} className={baseClasses}>
      {icon != null && (
        <span className="flex items-center justify-center w-4 h-4">{icon}</span>
      )}
      {children}
    </Link>
  );
};

export default NavLink;
