export const spriteConfig = {
  icons: [
    'IconArrow',
    'IconBrandGithub',
    'IconChevronsNarrow',
    'IconDiffSplit',
    'IconDiffUnified',
    'IconFile',
    'IconSymbolDiffstat',
    'IconSymbolAdded',
    'IconSymbolDeleted',
    'IconSymbolIgnored',
    'IconSymbolModified',
    'IconSymbolMoved',
    'IconSymbolRef',
  ],

  output: {
    file: 'packages/precision-diffs/src/sprite.ts',
    symbolPrefix: 'pjs-icon-',
  },

  source: {
    directory: './svgs',
    extension: '.svg',
  },
};
