import {
  DEFAULT_THEMES,
  type FileContents,
  parseDiffFromFile,
} from '@pierre/diffs';
import type { FileOptions } from '@pierre/diffs/react';
import type {
  PreloadFileDiffOptions,
  PreloadFileOptions,
} from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const LIVE_EDITING_OLD_FILE: FileContents = {
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

export const LIVE_EDITING_NEW_FILE: FileContents = {
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

// File-mode options for the Live editing example. Pre-enable the token
// transformer for SSR parity. Diff-only options do not apply to a File.
export const LIVE_EDITING_FILE_OPTIONS: FileOptions<undefined> = {
  theme: DEFAULT_THEMES,
  themeType: 'dark',
  unsafeCSS: CustomScrollbarCSS,
  useTokenTransformer: true,
};

// Server-side preload input for the File view of the Live editing example.
// Spreading the resolved result into <File> ships pre-rendered shadow DOM so
// the initial (default) File component paints from server HTML instead of
// flashing in after client highlighting.
export const LIVE_EDITING_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: LIVE_EDITING_NEW_FILE,
  options: LIVE_EDITING_FILE_OPTIONS,
};

// Server-side preload input for the FileDiff view of the Live editing example.
// Pre-enabling the token transformer keeps the SSR-rendered diff aligned with
// the attached editor so hydration does not flash.
export const LIVE_EDITING_FILE_DIFF_EXAMPLE: PreloadFileDiffOptions<undefined> =
  {
    fileDiff: parseDiffFromFile(LIVE_EDITING_OLD_FILE, LIVE_EDITING_NEW_FILE),
    options: {
      theme: DEFAULT_THEMES,
      themeType: 'dark',
      diffStyle: 'unified',
      unsafeCSS: CustomScrollbarCSS,
      useTokenTransformer: true,
    },
  };
