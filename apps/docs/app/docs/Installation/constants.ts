import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

export const INSTALLATION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'example.sh',
    contents: 'bun add @pierre/precision-diffs',
  },
  options: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
  },
};
