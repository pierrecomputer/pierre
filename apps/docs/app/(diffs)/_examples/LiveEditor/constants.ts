import { DEFAULT_THEMES, type FileContents } from '@pierre/diffs';
import type { MultiFileDiffProps } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const LIVE_EDITOR_OLD_FILE: FileContents = {
  name: 'debounce.ts',
  contents: `export interface DebounceOptions {
  waitMs: number;
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  options: DebounceOptions,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return (...args: Args) => {
    if (timer != null) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, options.waitMs);
  };
}
`,
};

export const LIVE_EDITOR_NEW_FILE: FileContents = {
  name: 'debounce.ts',
  contents: `export interface DebounceOptions {
  waitMs: number;
  trailing?: boolean;
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  options: DebounceOptions,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const debounced = (...args: Args) => {
    if (timer != null) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = undefined;
      if (options.trailing !== false) {
        fn(...args);
      }
    }, options.waitMs);
  };

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  return debounced;
}
`,
};

export const LIVE_EDITOR_OPTIONS: MultiFileDiffProps<undefined>['options'] = {
  theme: DEFAULT_THEMES,
  themeType: 'dark',
  diffStyle: 'unified',
  unsafeCSS: CustomScrollbarCSS,
  // Editor mode (contentEditable) forces these options when it attaches and
  // will rerender the surface if the hydrated markup doesn't already match.
  // Baking them into the preload makes the server HTML identical to the
  // editor's enforced state, so hydration doesn't cause a visible flash.
  useTokenTransformer: true,
  enableGutterUtility: false,
  enableLineSelection: false,
  expandUnchanged: true,
  lineHoverHighlight: 'disabled',
};

// Server-side preload input for the homepage Live editing example. Spreading
// the resolved result into <MultiFileDiff> ships pre-rendered shadow DOM so the
// diff paints immediately instead of flashing in after client highlighting.
export const LIVE_EDITOR_EXAMPLE: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: LIVE_EDITOR_OLD_FILE,
  newFile: LIVE_EDITOR_NEW_FILE,
  options: LIVE_EDITOR_OPTIONS,
};
