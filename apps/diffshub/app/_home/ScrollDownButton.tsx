'use client';

import { IconChevronFlat } from '@pierre/icons';

export function ScrollDownButton() {
  return (
    <button
      type="button"
      aria-label="Scroll down"
      className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 cursor-pointer md:hidden"
      onClick={() =>
        document
          .getElementById('home-more')
          ?.scrollIntoView({ behavior: 'smooth' })
      }
    >
      <IconChevronFlat className="text-muted-foreground size-4 rotate-90 opacity-25" />
    </button>
  );
}
