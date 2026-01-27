export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // For Tailwind
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'tailwind',
          'apply',
          'layer',
          'config',
          'plugin',
          'variants',
          'responsive',
          'screen',
          'theme',
          'custom-variant',
        ],
      },
    ],
    'selector-class-pattern': null,
    'no-descending-specificity': null,

    'property-no-vendor-prefix': null,
    'value-no-vendor-prefix': null,
    'declaration-property-value-keyword-no-deprecated': null,

    // Whitespace & Formatting
    'custom-property-empty-line-before': null,
    'comment-empty-line-before': null,
    'rule-empty-line-before': null,
    'declaration-empty-line-before': null,

    // Color Notation
    'color-function-notation': null,
    'color-function-alias-notation': null,
    'alpha-value-notation': null,
    'color-hex-length': null,
    'lightness-notation': null,
    'hue-degree-notation': null,

    // Value Formatting
    'value-keyword-case': null,
    'import-notation': null,
  },
};
