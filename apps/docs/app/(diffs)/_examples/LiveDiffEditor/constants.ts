import { DEFAULT_THEMES, parseDiffFromFile } from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

import {
  LIVE_EDITOR_NEW_FILE,
  LIVE_EDITOR_OLD_FILE,
} from '../LiveEditor/constants';
import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

// Server-side preload input for the "Live diff editing" example. We reuse the
// LiveEditor debounce.ts before/after files so the surface shows a real diff,
// then make the additions side editable in place. The options mirror the state
// the editor enforces when it attaches (see LIVE_EDITOR_OPTIONS) so the
// SSR-rendered diff matches the editor's surface and hydration doesn't flash.
export const LIVE_DIFF_EDITOR_EXAMPLE: PreloadFileDiffOptions<undefined> = {
  fileDiff: parseDiffFromFile(LIVE_EDITOR_OLD_FILE, LIVE_EDITOR_NEW_FILE),
  options: {
    theme: DEFAULT_THEMES,
    themeType: 'dark',
    diffStyle: 'unified',
    unsafeCSS: CustomScrollbarCSS,
    useTokenTransformer: true,
    enableGutterUtility: false,
    enableLineSelection: false,
    expandUnchanged: true,
    lineHoverHighlight: 'disabled',
  },
};
