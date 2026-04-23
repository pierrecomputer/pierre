import { DEFAULT_THEMES } from '@pierre/diffs';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const ARBITRARY_DIFF_EXAMPLE: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'example.css',
    contents: `.pizza {
  display: flex;
  justify-content: center;
}
`,
  },
  newFile: {
    name: 'example.css',
    contents: `.pizza {
  display: flex;
}
`,
  },
  options: {
    theme: DEFAULT_THEMES,
    themeType: 'dark',
    diffStyle: 'unified',
    unsafeCSS: CustomScrollbarCSS,
  },
};
