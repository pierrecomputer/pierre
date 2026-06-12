import { getCommentPersona } from '@/lib/annotation';
import { cn } from '@/lib/cn';

interface CommentAuthorAvatarProps {
  // A stable seed (e.g. comment key or a fixed name) used to pick the avatar.
  seed: string;
  className?: string;
}

// Renders a circular avatar image for a comment author.
// Defaults to 32px (size-8); pass className to override for other sizes.
export function CommentAuthorAvatar({
  seed,
  className,
}: CommentAuthorAvatarProps) {
  const { name, avatarSrc } = getCommentPersona(seed);
  return (
    <div className="relative shrink-0 self-start after:absolute after:inset-0 after:z-10 after:block after:rounded-full after:border after:border-[rgb(0_0_0_/_0.1)] after:content-[''] dark:after:border-[rgb(255_255_255_/_0.1)]">
      <img
        src={avatarSrc}
        alt={name}
        className={cn('block size-8 object-cover rounded-full', className)}
      />
    </div>
  );
}
