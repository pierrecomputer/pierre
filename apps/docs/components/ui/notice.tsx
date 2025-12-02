import { cn } from '@/lib/utils';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

const noticeVariants = cva('text-md flex gap-2 rounded-md border px-5 py-4', {
  variants: {
    variant: {
      info: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300',
      warning:
        'border-yellow-500/20 bg-yellow-500/10 text-yellow-600 dark:text-yellow-300',
      error: 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300',
      success:
        'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-300',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

export type NoticeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof noticeVariants> & {
    icon?: React.ReactNode;
  };

function Notice({ className, variant, icon, children, ...props }: NoticeProps) {
  return (
    <div className={cn(noticeVariants({ variant, className }))} {...props}>
      {icon != null && <div className="mt-[4px] flex-shrink-0">{icon}</div>}
      <div className="leading-[1.5]">{children}</div>
    </div>
  );
}

export { Notice, noticeVariants };
