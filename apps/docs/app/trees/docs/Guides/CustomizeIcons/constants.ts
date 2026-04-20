import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const ICONS_BASIC_SET = docsCodeSnippet(
  'icons-basic.ts',
  `const fileTree = new FileTree({
  paths,
  icons: 'standard',
});`
);

export const ICONS_COLORED_OFF = docsCodeSnippet(
  'icons-colored-off.ts',
  `const fileTree = new FileTree({
  paths,
  icons: {
    set: 'complete',
    colored: false,
  },
});`
);

export const ICONS_REMAP = docsCodeSnippet(
  'icons-remap.ts',
  `const fileTree = new FileTree({
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
});`
);

export const ICONS_SPRITE_SHEET = docsCodeSnippet(
  'icons-sprite-sheet.ts',
  `const fileTree = new FileTree({
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
});`
);
