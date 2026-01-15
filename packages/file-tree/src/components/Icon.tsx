import type { JSX } from 'preact';

import type { SVGSpriteNames } from '../sprite';

export function Icon({ name }: { name: SVGSpriteNames }): JSX.Element {
  'use no memo';
  const href = `#${name.replace(/^#/, '')}`;
  return (
    <svg viewBox="0 0 16 16" width="16" height="16">
      <use href={href} />
    </svg>
  );
}
