import { DEFAULT_THEMES } from '@pierre/diffs';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const ARBITRARY_DIFF_EXAMPLE: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'example.css',
    contents: `.pizza {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  background: #fff;
}
`,
  },
  newFile: {
    name: 'example.css',
    contents: `.pizza {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
  background: var(--surface);
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
