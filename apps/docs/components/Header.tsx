'use client';

import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import styles from './Header.module.css';
import { IconArrowUpRight } from './icons';

const Header = () => {
  const pathname = usePathname();

  return (
    <header className={styles.header}>
      <Link className={styles.brandLink} href="/">
        Precision Diffs
        <small className={styles.brandSubtitle}>
          by <span>The Pierre Computer Company</span>
        </small>
      </Link>
      <nav className={styles.nav}>
        <Link
          className={cn(styles.navLink, pathname === '/' && styles.active)}
          href="/"
        >
          Home
        </Link>
        {/* <Link className={styles.navLink} href="/playground">
          Playground
        </Link> */}
        <Link
          className={cn(
            styles.navLink,
            pathname.startsWith('/docs') && styles.active
          )}
          href="/docs"
        >
          Docs
        </Link>
        <Link className={styles.navLink} href="" target="_blank">
          Discord
          <IconArrowUpRight size={16} />
        </Link>
        <Link
          className={styles.navLink}
          href="https://github.com/pierreco/"
          target="_blank"
        >
          GitHub
          <IconArrowUpRight size={16} />
        </Link>
      </nav>
    </header>
  );
};

export default Header;
