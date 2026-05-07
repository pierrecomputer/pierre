// Shared pieces used by both DraftAnnotation and ExampleAnnotation.

import { cn } from '@/lib/utils';

export const annotationCardBase =
  'bg-card m-2 flex max-w-[600px] gap-2.5 rounded-xl border border-[rgb(0_0_0_/_0.1)] bg-clip-padding p-3 font-sans shadow-[0_2px_4px_rgb(0_0_0_/_0.05),0_4px_8px_rgb(0_0_0_/_0.075)] dark:border-[rgb(255_255_255_/_0.1)] dark:shadow-[0_2px_4px_rgb(0_0_0_/_0.25),0_4px_8px_rgb(0_0_0_/_0.25)] dark:bg-neutral-900/80';

interface CommentAuthorAvatarProps {
  author: string;
  className?: string;
}

// Renders a circular avatar showing the first letter of the author's name.
// Defaults to 32px (size-8); pass className to override for other sizes.
export function CommentAuthorAvatar({
  author,
  className,
}: CommentAuthorAvatarProps) {
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-lg font-medium text-purple-500',
        className
      )}
    >
      {author.charAt(0).toUpperCase()}
    </div>
  );
}
