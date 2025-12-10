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
        className={cn(
          'bg-secondary inline-flex self-start rounded-lg',
          className
        )}
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

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    context.onValueChange?.(value);
    onClick?.(event);
  };

  return (
    <Button
      className={cn(
        'text-muted-foreground rounded-[calc(var(--radius-lg)-1px)]',
        isSelected && 'text-foreground pointer-events-none shadow-xs',
        className
      )}
      variant={isSelected ? 'outline' : 'ghost'}
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
function EnhancedButtonGroup({ children, ...props }: ButtonGroupProps) {
  return (
    <ButtonGroup {...props}>
      <ButtonGroupProvider>{children}</ButtonGroupProvider>
    </ButtonGroup>
  );
}

EnhancedButtonGroup.displayName = 'ButtonGroup';

export { EnhancedButtonGroup as ButtonGroup, ButtonGroupItem };
