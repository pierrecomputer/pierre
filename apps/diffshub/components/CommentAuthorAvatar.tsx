import { cn } from '@/lib/cn';

interface CommentAuthorAvatarProps {
  name: string;
  src?: string;
  className?: string;
}

/** Uses the GitHub avatar, or the author's initial when the account is gone. */
export function CommentAuthorAvatar({
  name,
  src,
  className,
}: CommentAuthorAvatarProps) {
  return (
    <div className="relative shrink-0 self-start after:absolute after:inset-0 after:z-10 after:block after:rounded-full after:border after:border-[rgb(0_0_0_/_0.1)] after:content-[''] dark:after:border-[rgb(255_255_255_/_0.1)]">
      {src != null ? (
        <img
          src={src}
          alt=""
          className={cn('block size-8 object-cover rounded-full', className)}
        />
      ) : (
        <span
          aria-label={name}
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-full bg-muted text-sm',
            className
          )}
        >
          {name.slice(0, 1)}
        </span>
      )}
    </div>
  );
}
