import { DEFAULT_THEMES, type FileContents } from '@pierre/diffs';
import type { FileOptions, MultiFileDiffProps } from '@pierre/diffs/react';
import type {
  PreloadFileOptions,
  PreloadMultiFileDiffOptions,
} from '@pierre/diffs/ssr';

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
  // The editor requires the token transformer and rerenders when it enables it
  // after attaching. Enable it in the preload so hydration does not flash.
  useTokenTransformer: true,
};

// Server-side preload input for the homepage Live editing example. Spreading
// the resolved result into <MultiFileDiff> ships pre-rendered shadow DOM so the
// diff paints immediately instead of flashing in after client highlighting.
export const LIVE_EDITOR_EXAMPLE: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: LIVE_EDITOR_OLD_FILE,
  newFile: LIVE_EDITOR_NEW_FILE,
  options: LIVE_EDITOR_OPTIONS,
};

// File-mode options for the Live editing example. Pre-enable the token
// transformer for SSR parity (see LIVE_EDITOR_OPTIONS). The diff-only diffStyle
// key does not apply to a File.
export const LIVE_EDITOR_FILE_OPTIONS: FileOptions<undefined> = {
  theme: DEFAULT_THEMES,
  themeType: 'dark',
  unsafeCSS: CustomScrollbarCSS,
  useTokenTransformer: true,
};

// Server-side preload input for the File view of the Live editing example.
// Spreading the resolved result into <File> ships pre-rendered shadow DOM so
// the initial (default) File surface paints from server HTML instead of
// flashing in after client highlighting.
export const LIVE_EDITOR_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: LIVE_EDITOR_NEW_FILE,
  options: LIVE_EDITOR_FILE_OPTIONS,
};
