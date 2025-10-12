'use client';

import { cn } from '@/lib/utils';
import * as React from 'react';

import { Button, type ButtonProps } from './button';

interface ButtonGroupContextValue {
  selectedValue?: string;
  onValueChange?: (value: string) => void;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}

const ButtonGroupContext = React.createContext<ButtonGroupContextValue>({});

interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  onValueChange?: (value: string) => void;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  children: React.ReactNode;
}

function ButtonGroup({
  className,
  value,
  onValueChange,
  variant = 'outline',
  size,
  children,
  ...props
}: ButtonGroupProps) {
  return (
    <ButtonGroupContext.Provider
      value={{
        selectedValue: value,
        onValueChange,
        variant,
        size,
      }}
    >
      <div
        className={cn('inline-flex rounded-md shadow-sm', className)}
        role="group"
        {...props}
      >
        {children}
      </div>
    </ButtonGroupContext.Provider>
  );
}

interface ButtonGroupItemProps extends Omit<ButtonProps, 'variant'> {
  value: string;
  children: React.ReactNode;
}

function ButtonGroupItem({
  className,
  value,
  children,
  onClick,
  ...props
}: ButtonGroupItemProps) {
  const context = React.useContext(ButtonGroupContext);
  const isSelected = context.selectedValue === value;
  const isFirst = React.useContext(ButtonGroupPositionContext) === 'first';
  const isLast = React.useContext(ButtonGroupPositionContext) === 'last';
  const isMiddle = React.useContext(ButtonGroupPositionContext) === 'middle';

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    context.onValueChange?.(value);
    onClick?.(event);
  };

  return (
    <Button
      className={cn(
        isFirst && 'rounded-r-none',
        isLast && 'rounded-l-none',
        isMiddle && 'rounded-none border-x-0',
        className
      )}
      variant={isSelected ? 'default' : context.variant}
      size={context.size}
      onClick={handleClick}
      {...props}
    >
      {children}
    </Button>
  );
}

const ButtonGroupPositionContext = React.createContext<
  'first' | 'middle' | 'last' | 'only'
>('only');

function ButtonGroupProvider({ children }: { children: React.ReactNode }) {
  const childrenArray = React.Children.toArray(children);
  const childCount = childrenArray.length;

  return (
    <>
      {childrenArray.map((child, index) => {
        let position: 'first' | 'middle' | 'last' | 'only' = 'only';

        if (childCount > 1) {
          if (index === 0) position = 'first';
          else if (index === childCount - 1) position = 'last';
          else position = 'middle';
        }

        return (
          <ButtonGroupPositionContext.Provider key={index} value={position}>
            {child}
          </ButtonGroupPositionContext.Provider>
        );
      })}
    </>
  );
}

// Enhance ButtonGroup to automatically provide position context
const EnhancedButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>(
  ({ children, ...props }, ref) => (
    <ButtonGroup ref={ref} {...props}>
      <ButtonGroupProvider>{children}</ButtonGroupProvider>
    </ButtonGroup>
  )
);

EnhancedButtonGroup.displayName = 'ButtonGroup';

export { EnhancedButtonGroup as ButtonGroup, ButtonGroupItem };
