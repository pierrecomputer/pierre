import { IconArrowDownRight } from '@pierre/icons';
import Link from 'next/link';

import { IconFootnote } from './IconFootnote';

export function PierreThemeFootnote() {
  return (
    <IconFootnote icon={<IconArrowDownRight />}>
      Love the Pierre themes?{' '}
      <Link href="/theme" className="inline-link">
        Install our Pierre Theme pack
      </Link>{' '}
      with light and dark flavors, or learn how to build your own Shiki themes.
    </IconFootnote>
  );
}
