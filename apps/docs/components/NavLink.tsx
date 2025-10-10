'use client';

import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';

import styles from './NavLink.module.css';
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

  const linkClasses = cn(styles.navLink, isActive && styles.active, className);

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClasses}
      >
        {icon != null && <span className={styles.navLinkIcon}>{icon}</span>}
        <span className={styles.navLinkText}>{children}</span>
        <IconArrowUpRight color="fg4" />
      </a>
    );
  }

  return (
    <Link href={href} className={linkClasses}>
      {icon != null && <span className={styles.navLinkIcon}>{icon}</span>}
      {children}
    </Link>
  );
};

export default NavLink;
