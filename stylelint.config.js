export default {
  extends: ['stylelint-config-standard', 'stylelint-prettier/recommended'],
  rules: {
    // Allow CSS custom properties (CSS variables)
    'custom-property-pattern': null,
    'custom-property-empty-line-before': null,

    // Allow custom selectors
    'selector-class-pattern': null,
    'selector-id-pattern': null,

    // Allow vendor prefixes (sometimes needed for compatibility)
    'property-no-vendor-prefix': null,
    'value-no-vendor-prefix': null,

    // Allow unknown at-rules (for things like @tailwind, @layer, etc.)
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'tailwind',
          'apply',
          'variants',
          'responsive',
          'screen',
          'layer',
          'theme',
          'custom-variant',
        ],
      },
    ],

    // Allow CSS nesting (modern CSS feature)
    'selector-nested-pattern': null,

    // Disable some overly strict rules
    'no-descending-specificity': null,
    'no-duplicate-selectors': null,
    'declaration-block-no-duplicate-properties': null, // Allow duplicates for fallbacks
    'declaration-block-no-redundant-longhand-properties': null,
    'shorthand-property-no-redundant-values': null,

    // Allow empty sources (for files that might only have comments)
    'no-empty-source': null,

    // Allow font names with capitals (Monaco, Consolas, Arial, etc.)
    'value-keyword-case': null,

    // Be flexible with import notation
    'import-notation': null,

    // Be flexible with color notation
    'color-function-notation': null,
    'color-function-alias-notation': null,
    'alpha-value-notation': null,
    'color-hex-length': null,
    'hue-degree-notation': null,
    'lightness-notation': null,

    // Be flexible with media feature notation
    'media-feature-range-notation': null,

    // Be flexible with spacing
    'declaration-empty-line-before': null,
    'rule-empty-line-before': null,
    'comment-empty-line-before': null,

    // Allow deprecated keywords (sometimes needed for compatibility)
    'declaration-property-value-keyword-no-deprecated': null,
  },
  overrides: [
    {
      // CSS Modules specific rules
      files: ['**/*.module.css'],
      rules: {
        'selector-class-pattern': null,
      },
    },
  ],
};
