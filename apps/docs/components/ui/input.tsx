import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

// Sizes are kept in lockstep with `Button` so an Input + Button paired in the
// same row line up at the same height/radius/padding rhythm.
const inputVariants = cva(
  'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input w-full min-w-0 border bg-transparent shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:border-0 file:bg-transparent file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
  {
    variants: {
      inputSize: {
        default:
          'h-9 rounded-md px-3 py-1 text-base file:h-7 file:text-sm md:text-sm',
        lg: 'h-10 rounded-md px-4 text-base file:h-8 file:text-sm',
      },
    },
    defaultVariants: {
      inputSize: 'default',
    },
  }
);

// `inputSize` is used instead of `size` because `size` is a native HTML input
// attribute (character-width hint) and we don't want our variant prop to
// shadow it.
export type InputProps = Omit<React.ComponentProps<'input'>, 'size'> &
  VariantProps<typeof inputVariants>;

function Input({ className, type, inputSize, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ inputSize, className }))}
      {...props}
    />
  );
}

export { Input, inputVariants };
