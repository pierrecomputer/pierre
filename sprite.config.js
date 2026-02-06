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
    file: 'packages/diffs/src/sprite.ts',
    symbolPrefix: 'diffs-icon-',
  },

  source: {
    extension: '.svg',
  },
};
