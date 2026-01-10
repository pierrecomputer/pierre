import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadFileOptions } from '@pierre/diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const THEMING_PROJECT_STRUCTURE: PreloadFileOptions<undefined> = {
  file: {
    name: 'project-structure.txt',
    lang: 'text',
    contents: `theme/
├── src/
│   ├── palette.ts      # Color definitions (edit this!)
│   ├── theme.ts        # Token color mappings
│   └── index.ts        # Build script entry point
├── themes/             # Generated theme JSON files
│   ├── pierre-dark.json
│   ├── pierre-light.json
│   ├── pierre-dark-vibrant.json
│   └── pierre-light-vibrant.json
├── package.json        # Update with your details
├── DISPLAY-P3.md       # Info on vibrant theme generation
└── README.md`,
  },
  options,
};

export const THEMING_PALETTE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'src/palette.ts',
    contents: `// Define your color palette — this is the single source of truth
// for all theme variants (light, dark, vibrant)

export const palette = {
  // Background colors
  scale: {
    black: '#070707',
    white: '#fbfbfb',
    gray: ['#141415', '#1F1F21', '#39393c', '#424245', '#79797F', '#84848A', '#adadb1'],
  },

  // Accent colors — used for syntax highlighting
  red:     '#ff2e3f',
  green:   '#0dbe4e',
  blue:    '#009fff',
  purple:  '#7b43f8',
  cyan:    '#00cab1',
  orange:  '#fe8c2c',
  yellow:  '#ffca00',
  magenta: '#c635e4',

  // Muted variants — softer colors for dark theme tokens
  redMuted:     '#ff678d',
  greenMuted:   '#5ecc71',
  blueMuted:    '#69b1ff',
  purpleMuted:  '#9d6afb',
  cyanMuted:    '#61d5c0',
  orangeMuted:  '#ffa359',
  yellowMuted:  '#ffd452',
  magentaMuted: '#d568ea',
};`,
  },
  options,
};

export const THEMING_TOKEN_COLORS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'src/theme.ts',
    contents: `import { palette } from './palette';

// Map palette colors to syntax token scopes
export function getTokenColors(variant: 'light' | 'dark') {
  const isDark = variant === 'dark';

  return [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: palette.scale.gray[5] },
    },
    {
      scope: ['string', 'constant.other.symbol'],
      settings: { foreground: isDark ? palette.greenMuted : palette.green },
    },
    {
      scope: ['keyword', 'storage', 'storage.type'],
      settings: { foreground: isDark ? palette.redMuted : palette.red },
    },
    {
      scope: ['entity.name.function', 'support.function'],
      settings: { foreground: isDark ? palette.purpleMuted : palette.purple },
    },
    {
      scope: ['entity.name.type', 'entity.name.class'],
      settings: { foreground: isDark ? palette.magentaMuted : palette.magenta },
    },
    {
      scope: ['variable', 'meta.definition.variable'],
      settings: { foreground: isDark ? palette.orangeMuted : palette.orange },
    },
    {
      scope: ['constant.numeric', 'constant.language.boolean'],
      settings: { foreground: isDark ? palette.cyanMuted : palette.cyan },
    },
    // ... additional token rules
  ];
}`,
  },
  options,
};

export const THEMING_PACKAGE_JSON_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'package.json',
    contents: `{
  "name": "my-custom-theme",
  "displayName": "My Custom Theme",
  "description": "A beautiful theme for VS Code and Shiki",
  "version": "1.0.0",
  "publisher": "your-publisher-id",
  "author": "Your Name",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_USERNAME/my-custom-theme"
  },
  "categories": ["Themes"],
  "contributes": {
    "themes": [
      {
        "label": "My Theme Dark",
        "uiTheme": "vs-dark",
        "path": "./themes/my-theme-dark.json"
      },
      {
        "label": "My Theme Light",
        "uiTheme": "vs",
        "path": "./themes/my-theme-light.json"
      }
    ]
  }
}`,
  },
  options,
};

export const THEMING_REGISTER_THEME: PreloadFileOptions<undefined> = {
  file: {
    name: 'register-theme.ts',
    contents: `import { registerCustomTheme } from '@pierre/diffs';

// Register your theme JSON files before rendering
// The name must match the "name" field in your theme JSON

// Option 1: Import from your bundled theme files
registerCustomTheme('my-theme-dark', () => import('./themes/my-theme-dark.json'));
registerCustomTheme('my-theme-light', () => import('./themes/my-theme-light.json'));

// Option 2: Fetch from a URL (for CDN-hosted themes)
registerCustomTheme('my-theme-dark', async () => {
  const response = await fetch('/themes/my-theme-dark.json');
  return response.json();
});`,
  },
  options,
};

export const THEMING_USE_IN_COMPONENT: PreloadFileOptions<undefined> = {
  file: {
    name: 'DiffWithCustomTheme.tsx',
    contents: `import { FileDiff } from '@pierre/diffs/react';

export function DiffWithCustomTheme({ fileDiff }) {
  return (
    <FileDiff
      fileDiff={fileDiff}
      options={{
        // Single theme
        theme: 'my-theme-dark',

        // Or both variants for automatic light/dark mode
        theme: {
          dark: 'my-theme-dark',
          light: 'my-theme-light',
        },
      }}
    />
  );
}`,
  },
  options,
};
