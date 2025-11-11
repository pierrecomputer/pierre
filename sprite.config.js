export const spriteConfig = {
  icons: [
    'IconArrowRightShort',
    'IconBrandGithub',
    'IconChevronsNarrow',
    'IconChevron',
    'IconDiffSplit',
    'IconDiffUnified',
    'IconExpand',
    'IconExpandAll',
    'IconFileCode',
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
