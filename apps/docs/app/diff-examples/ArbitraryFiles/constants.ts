import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadMultiFileDiffOptions } from '@pierre/precision-diffs/ssr';

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
    theme: 'pierre-dark',
    diffStyle: 'unified',
    unsafeCSS: CustomScrollbarCSS,
  },
};
