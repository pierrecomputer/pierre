import { IconCheck, IconCopyFill } from '@pierre/icons';

import { cn } from '@/lib/utils';

export const COPY_FEEDBACK_MS = 2000;

// Must name `scale`, not `transform`: Tailwind v4 emits scale utilities on the
// standalone CSS `scale` property and leaves `transform` as `none`.
const POP_TRANSITION =
  'transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none';

export interface CopyStateIconProps {
  copied: boolean;
  className?: string;
}

// The enclosing button or menu row must carry `group` for the hover state.
// Keep `group-hover` out of the copied branch or it overrides `opacity-0` and
// fades the copy icon back in behind the check.
export function CopyStateIcon({ copied, className }: CopyStateIconProps) {
  return (
    <span className={cn('relative size-4 shrink-0', className)}>
      <IconCopyFill
        aria-hidden
        className={cn(
          'absolute inset-0',
          POP_TRANSITION,
          copied
            ? 'scale-0 opacity-0'
            : 'scale-100 opacity-60 group-hover:opacity-100'
        )}
      />
      <IconCheck
        aria-hidden
        className={cn(
          'absolute inset-0 text-emerald-500',
          POP_TRANSITION,
          copied ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
        )}
      />
    </span>
  );
}
