'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface InputGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

interface InputGroupIconProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  position?: 'left' | 'right';
}

function InputGroup({ className, children, ...props }: InputGroupProps) {
  return (
    <div className={cn('relative flex items-center', className)} {...props}>
      {children}
    </div>
  );
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <input
      data-slot="input-group-input"
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input bg-background h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        'peer',
        className
      )}
      {...props}
    />
  );
}

function InputGroupIcon({
  className,
  children,
  position = 'left',
  ...props
}: InputGroupIconProps) {
  return (
    <div
      className={cn(
        'text-muted-foreground pointer-events-none absolute z-10 flex items-center justify-center',
        position === 'left' && 'left-3',
        position === 'right' && 'right-3',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// Wrapper component that handles icon positioning and input padding
interface InputWithIconProps extends React.ComponentProps<'input'> {
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

function InputWithIcon({
  icon,
  iconPosition = 'left',
  className,
  ...props
}: InputWithIconProps) {
  return (
    <InputGroup>
      {icon != null && (
        <InputGroupIcon position={iconPosition}>{icon}</InputGroupIcon>
      )}
      <InputGroupInput
        className={cn(
          icon != null && iconPosition === 'left' && 'pl-10',
          icon != null && iconPosition === 'right' && 'pr-10',
          className
        )}
        {...props}
      />
    </InputGroup>
  );
}

export { InputGroup, InputGroupInput, InputGroupIcon, InputWithIcon };
