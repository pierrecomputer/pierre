import { cn } from '@/lib/utils';
import React from 'react';

import styles from './ButtonGroup.module.css';

interface ButtonGroupProps {
  children: React.ReactNode;
  className?: string;
}

const ButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>(
  ({ children, className }, ref) => {
    return (
      <div ref={ref} className={cn(styles.buttonGroup, className)}>
        {children}
      </div>
    );
  }
);

ButtonGroup.displayName = 'ButtonGroup';

export default ButtonGroup;
