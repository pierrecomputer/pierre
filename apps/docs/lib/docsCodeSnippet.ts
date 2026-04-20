import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

type SnippetOptions = PreloadFileOptions<undefined>['options'];

const SHARED_OPTIONS = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const satisfies SnippetOptions;

/**
 * Build a `PreloadFileOptions` entry with the shared docs snippet options
 * already baked in. Pass `optionOverrides` to tweak a single entry (e.g.
 * re-enable the file header for a snippet that benefits from a filename).
 */
export function docsCodeSnippet(
  name: string,
  contents: string,
  optionOverrides?: Partial<SnippetOptions>
): PreloadFileOptions<undefined> {
  return {
    file: { name, contents },
    options:
      optionOverrides != null
        ? { ...SHARED_OPTIONS, ...optionOverrides }
        : SHARED_OPTIONS,
  };
}
