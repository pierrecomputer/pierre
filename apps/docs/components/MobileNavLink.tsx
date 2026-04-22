'use client';

import { IconArrowUpRightCircle } from '@pierre/icons';
import Link from 'next/link';

import { cn } from '@/lib/utils';

interface MobileNavLinkProps {
  href: string;
  children: React.ReactNode;
  external?: boolean;
  onClick?: () => void;
}

export function MobileNavLink({
  href,
  children,
  external,
  onClick,
}: MobileNavLinkProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'text-foreground flex items-center gap-1.5 rounded-md px-3 py-2 text-base transition-colors',
        'hover:bg-muted active:bg-muted/70'
      )}
    >
      {children}
      {external === true && (
        <IconArrowUpRightCircle className="text-muted-foreground" />
      )}
    </Link>
  );
}

export default MobileNavLink;
