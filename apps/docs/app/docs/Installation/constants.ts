import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

export const INSTALLATION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'example.sh',
    contents: 'bun add @pierre/precision-diffs',
  },
  options: {
    themes: { dark: 'pierre-dark', light: 'pierre-light' },
  },
};
