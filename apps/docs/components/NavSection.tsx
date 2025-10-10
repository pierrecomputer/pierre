import { cn } from '@/lib/utils';
import { type ReactNode } from 'react';

import styles from './NavSection.module.css';

interface NavSectionProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

const NavSection = ({ title, children, className }: NavSectionProps) => {
  return (
    <div className={cn(styles.navSection, className)}>
      {title && <h3 className={styles.navSectionTitle}>{title}</h3>}
      <ul className={styles.navSectionList}>{children}</ul>
    </div>
  );
};

export default NavSection;
