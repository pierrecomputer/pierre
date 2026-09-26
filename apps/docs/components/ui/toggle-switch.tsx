'use client';

import * as React from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ToggleSwitchProps {
  label: React.ReactNode;
  icon?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}

/**
 * A toggle pill built as one native control: a `<label>` wrapping a
 * visually-hidden checkbox styled to look like a switch.
 */
export function ToggleSwitch({
  label,
  icon,
  checked,
  onCheckedChange,
  disabled = false,
  title,
  className,
}: ToggleSwitchProps) {
  return (
    <label
      title={title}
      className={cn(
        buttonVariants({ variant: checked ? 'outline' : 'secondary' }),
        !checked && 'border border-transparent',
        'justify-between gap-3 px-3',
        disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer',
        className
      )}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'bg-input peer-checked:bg-primary relative inline-flex h-4 w-6 shrink-0 items-center rounded-full border-2 border-transparent transition-colors',
          'peer-focus-visible:ring-ring peer-focus-visible:ring-offset-background peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
          "after:pointer-events-none after:absolute after:top-0 after:left-0 after:h-3 after:w-3 after:rounded-full after:bg-background after:shadow-lg after:transition-transform after:content-['']",
          'peer-checked:after:translate-x-2'
        )}
      />
    </label>
  );
}
