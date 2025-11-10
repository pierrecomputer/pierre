export default {
  extends: ['stylelint-config-standard', 'stylelint-prettier/recommended'],
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
    // 'no-duplicate-selectors': null,

    'property-no-vendor-prefix': null,
    'value-no-vendor-prefix': null,
    'declaration-property-value-keyword-no-deprecated': null,

    // === Style Flexibility (not errors, just preferences) ===
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
    // 'shorthand-property-no-redundant-values': null,
    // 'declaration-block-no-redundant-longhand-properties': null,

    // Modern CSS Features
    // 'media-feature-range-notation': null,
  },
};
