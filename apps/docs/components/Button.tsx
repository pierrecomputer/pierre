import React from 'react';

import styles from './Button.module.css';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'default' | 'active';
  asChild?: boolean;
}

interface ButtonLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children: React.ReactNode;
  variant?: 'default' | 'active';
  asChild?: boolean;
}

type ButtonComponent = React.ForwardRefExoticComponent<
  ButtonProps & React.RefAttributes<HTMLButtonElement>
> & {
  Link: React.ForwardRefExoticComponent<
    ButtonLinkProps & React.RefAttributes<HTMLAnchorElement>
  >;
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = 'default', className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          styles.button,
          variant === 'active' && styles.active,
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ children, variant = 'default', className, ...props }, ref) => {
    return (
      <a
        ref={ref}
        className={cn(
          styles.button,
          variant === 'active' && styles.active,
          className
        )}
        {...props}
      >
        {children}
      </a>
    );
  }
);

ButtonLink.displayName = 'ButtonLink';

const ButtonWithLink = Button as ButtonComponent;
ButtonWithLink.Link = ButtonLink;

export default ButtonWithLink;
