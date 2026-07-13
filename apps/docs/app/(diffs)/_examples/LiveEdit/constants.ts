import { DEFAULT_THEMES, type FileContents } from '@pierre/diffs';
import type { FileOptions, MultiFileDiffProps } from '@pierre/diffs/react';
import type {
  PreloadFileOptions,
  PreloadMultiFileDiffOptions,
} from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const LIVE_EDIT_OLD_FILE: FileContents = {
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

export const LIVE_EDIT_NEW_FILE: FileContents = {
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

export const LIVE_EDIT_OPTIONS: MultiFileDiffProps<undefined>['options'] = {
  theme: DEFAULT_THEMES,
  themeType: 'dark',
  diffStyle: 'unified',
  unsafeCSS: CustomScrollbarCSS,
  // Edit mode (contentEditable) forces these options when it attaches and
  // will rerender the surface if the hydrated markup doesn't already match.
  // Baking them into the preload makes the server HTML identical to the
  // edit's enforced state, so hydration doesn't cause a visible flash.
  useTokenTransformer: true,
  enableGutterUtility: false,
  enableLineSelection: false,
  lineHoverHighlight: 'disabled',
};

// Server-side preload input for the homepage Live editing example. Spreading
// the resolved result into <MultiFileDiff> ships pre-rendered shadow DOM so the
// diff paints immediately instead of flashing in after client highlighting.
export const LIVE_EDIT_EXAMPLE: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: LIVE_EDIT_OLD_FILE,
  newFile: LIVE_EDIT_NEW_FILE,
  options: LIVE_EDIT_OPTIONS,
};

// File-mode options for the Live editing example. They mirror edit mode's
// enforced contentEditable state (see LIVE_EDIT_OPTIONS) so the SSR-rendered
// File matches what edit mode attaches to, avoiding a rerender flash on
// hydration. The diff-only diffStyle key doesn't apply to a File.
export const LIVE_EDIT_FILE_OPTIONS: FileOptions<undefined> = {
  theme: DEFAULT_THEMES,
  themeType: 'dark',
  unsafeCSS: CustomScrollbarCSS,
  useTokenTransformer: true,
  enableGutterUtility: false,
  enableLineSelection: false,
  lineHoverHighlight: 'disabled',
};

// Server-side preload input for the File view of the Live editing example.
// Spreading the resolved result into <File> ships pre-rendered shadow DOM so
// the initial (default) File surface paints from server HTML instead of
// flashing in after client highlighting.
export const LIVE_EDIT_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: LIVE_EDIT_NEW_FILE,
  options: LIVE_EDIT_FILE_OPTIONS,
};
