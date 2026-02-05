import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const noticeVariants = cva('text-md flex gap-2 rounded-lg border p-4', {
  variants: {
    variant: {
      default: 'bg-secondary/50 text-muted-foreground',
      info: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
      warning:
        'border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
      error: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300',
      success:
        'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-300',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export type NoticeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof noticeVariants> & {
    icon?: React.ReactNode;
  };

function Notice({ className, variant, icon, children, ...props }: NoticeProps) {
  return (
    <div className={cn(noticeVariants({ variant, className }))} {...props}>
      {icon != null && (
        <div className="mt-[2px] flex-shrink-0 md:mt-[4px]">{icon}</div>
      )}
      <div className="leading-[1.5]">{children}</div>
    </div>
  );
}

export { Notice, noticeVariants };
