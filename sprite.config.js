export const spriteConfig = {
  icons: [
    'IconArrowShort',
    'IconArrowUpRight',
    'IconBook',
    'IconCopyFill',
    'IconDiffSplit',
    'IconDiffUnified',
    'IconSymbolDiffstat',
    'IconSymbolAdded',
    'IconSymbolDeleted',
    'IconSymbolIgnored',
    'IconSymbolModified',
    'IconSymbolMoved',
    'IconSymbolRef',
    'IconBrandGithub',
  ],

  output: {
    file: 'apps/docs/app/IconSprite.tsx',
    symbolPrefix: 'pjs-icon-',
  },

  source: {
    directory: './svgs',
    extension: '.svg',
  },
};
