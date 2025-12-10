export default {
  semi: true,
  trailingComma: 'es5',
  singleQuote: true,
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  proseWrap: 'always',
  importOrder: ['<THIRD_PARTY_MODULES>', '^\\.'],
  importOrderSortSpecifiers: true,
  importOrderSeparation: true,
  plugins: [
    '@trivago/prettier-plugin-sort-imports',
    'prettier-plugin-tailwindcss',
  ],
};
