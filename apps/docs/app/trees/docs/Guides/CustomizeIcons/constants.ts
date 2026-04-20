import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const ICONS_BASIC_SET: PreloadFileOptions<undefined> = {
  file: {
    name: 'icons-basic.ts',
    contents: `const fileTree = new FileTree({
  paths,
  icons: 'standard',
});`,
  },
  options,
};

export const ICONS_COLORED_OFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'icons-colored-off.ts',
    contents: `const fileTree = new FileTree({
  paths,
  icons: {
    set: 'complete',
    colored: false,
  },
});`,
  },
  options,
};

export const ICONS_REMAP: PreloadFileOptions<undefined> = {
  file: {
    name: 'icons-remap.ts',
    contents: `const fileTree = new FileTree({
  paths,
  icons: {
    set: 'standard',
    byFileName: {
      'package.json': 'icon-package-json',
    },
    byFileExtension: {
      'spec.ts': 'icon-test-file',
    },
    byFileNameContains: {
      dockerfile: 'icon-dockerfile',
    },
    remap: {
      'file-tree-icon-lock': 'icon-locked',
    },
  },
});`,
  },
  options,
};

export const ICONS_SPRITE_SHEET: PreloadFileOptions<undefined> = {
  file: {
    name: 'icons-sprite-sheet.ts',
    contents: `const fileTree = new FileTree({
  paths,
  icons: {
    set: 'standard',
    spriteSheet: \`
      <svg aria-hidden="true" width="0" height="0">
        <symbol id="icon-package-json" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="7" fill="currentColor" />
        </symbol>
      </svg>
    \`,
    byFileName: {
      'package.json': 'icon-package-json',
    },
  },
});`,
  },
  options,
};
