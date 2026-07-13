import { DEFAULT_THEMES, parseDiffFromFile } from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

import { LIVE_EDIT_NEW_FILE, LIVE_EDIT_OLD_FILE } from '../LiveEdit/constants';
import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

// Server-side preload input for the "Live diff editing" example. We reuse the
// LiveEdit debounce.ts before/after files so the surface shows a real diff,
// then make the additions side editable in place. The options mirror the state
// edit mode enforces when it attaches (see LIVE_EDIT_OPTIONS) so the
// SSR-rendered diff matches edit mode's surface and hydration doesn't flash.
export const LIVE_DIFF_EDIT_EXAMPLE: PreloadFileDiffOptions<undefined> = {
  fileDiff: parseDiffFromFile(LIVE_EDIT_OLD_FILE, LIVE_EDIT_NEW_FILE),
  options: {
    theme: DEFAULT_THEMES,
    themeType: 'dark',
    diffStyle: 'unified',
    unsafeCSS: CustomScrollbarCSS,
    useTokenTransformer: true,
    enableGutterUtility: false,
    enableLineSelection: false,
    lineHoverHighlight: 'disabled',
  },
};
