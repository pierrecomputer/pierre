// Shared pieces used by both DraftAnnotation and ExampleAnnotation.

import { cn } from '@/lib/utils';

export const annotationCardBase =
  'bg-card m-2 flex max-w-[600px] gap-2.5 rounded-xl border border-[rgb(0_0_0_/_0.1)] bg-clip-padding p-3 font-sans shadow-[0_2px_4px_rgb(0_0_0_/_0.025),0_4px_8px_rgb(0_0_0_/_0.025)] dark:border-[rgb(255_255_255_/_0.1)] dark:shadow-[0_2px_4px_rgb(0_0_0_/_0.25),0_4px_8px_rgb(0_0_0_/_0.25)] dark:bg-neutral-900/80';

// All available reviewer personas, derived from /public/diffshub-avatars/ filenames.
const AVATAR_NAMES = [
  'amacateus',
  'amadeus',
  'aussie',
  'cedric',
  'chugs',
  'ed',
  'fat',
  'ian',
  'jacob2',
  'joe',
  'kris',
  'mdo',
  'nicolas',
  'pia',
  'toshi',
  'zac',
] as const;

export type AvatarName = (typeof AVATAR_NAMES)[number];

export interface Persona {
  name: AvatarName;
  avatarSrc: string;
}

// Triggers browser fetches for all avatar images so they are in the cache
// before the comment form opens. Call once on mount of the top-level UI component.
export function preloadAvatars(): void {
  for (const name of AVATAR_NAMES) {
    const img = new Image();
    img.src = `/diffshub-avatars/${name}.png`;
  }
}

function buildPersona(name: AvatarName): Persona {
  return { name, avatarSrc: `/diffshub-avatars/${name}.png` };
}

// Picks a random persona from the avatar list. Intended for use as a useState
// lazy initializer so each new draft form gets a fresh identity on mount.
export function getRandomPersona(): Persona {
  const name = AVATAR_NAMES[Math.floor(Math.random() * AVATAR_NAMES.length)];
  return buildPersona(name);
}

// Returns a persona for the given name or seed. If the seed is an exact avatar
// name (i.e. it was stored directly from getRandomPersona), returns that persona
// directly so draft and saved annotations stay in sync. Otherwise falls back to
// a djb2 hash to spread arbitrary comment keys across the avatar list.
export function getCommentPersona(seed: string): Persona {
  if (AVATAR_NAMES.includes(seed as AvatarName)) {
    return buildPersona(seed as AvatarName);
  }
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  }
  return buildPersona(AVATAR_NAMES[hash % AVATAR_NAMES.length]);
}

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
    <img
      src={avatarSrc}
      alt={name}
      className={cn('size-8 shrink-0 rounded-full object-cover', className)}
    />
  );
}
