import { IconArrowDownRight } from '@pierre/icons';
import Link from 'next/link';

import { IconFootnote } from './IconFootnote';
import { DIFFS_THEME_PATH, getExternalUrl } from '@/lib/product-config';

export function PierreThemeFootnote() {
  return (
    <IconFootnote icon={<IconArrowDownRight />}>
      Love the Pierre themes?{' '}
      <Link
        href={`${getExternalUrl('diffs')}${DIFFS_THEME_PATH}`}
        className="inline-link"
      >
        Install our Pierre Theme pack
      </Link>{' '}
      with light and dark flavors, or learn how to build your own Shiki themes.
    </IconFootnote>
  );
}
