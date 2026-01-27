import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  unsafeCSS: CustomScrollbarCSS,
  lineNumbers: false,
} as const;

const THEME_REPO_BASE = 'https://github.com/pierrecomputer/theme/blob/main';

type ThemingConstant = PreloadFileOptions<undefined> & { href?: string };

export const THEMING_PROJECT_STRUCTURE: ThemingConstant = {
  file: {
    name: 'project-structure.txt',
    lang: 'text',
    contents: `theme/
├── src/
│   ├── build.ts        # Build script entry point
│   ├── color-p3.ts     # Display P3 color definitions
│   ├── palette.ts      # Color definitions (edit this!)
│   ├── package-vsix.ts # Generates VS Code/Cursor extension
│   └── theme.ts        # Token color mappings
├── themes/             # Generated theme JSON files
│   ├── pierre-dark.json
│   ├── pierre-light.json
│   ├── pierre-dark-vibrant.json
│   └── pierre-light-vibrant.json
└── package.json        # Update with your details`,
  },
  options,
};

export const THEMING_PALETTE_COLORS: ThemingConstant = {
  href: `${THEME_REPO_BASE}/src/palette.ts`,
  file: {
    name: 'src/palette.ts',
    contents: `const gray = {
  "020":"#fbfbfb",
  "040":"#f9f9f9",
  "060":"#f8f8f8",
  "080":"#f2f2f3",
  "100":"#eeeeef",
  "200":"#dbdbdd",
  "300":"#c6c6c8",
  "400":"#adadb1",
  "500":"#8E8E95",
  "600":"#84848A",
  "700":"#79797F",
  "800":"#6C6C71",
  "900":"#4A4A4E",
  "920":"#424245",
  "940":"#39393c",
  "960":"#2e2e30",
  "980":"#1F1F21",
  "1000":"#141415",
  "1020":"#0B0B0C",
  "1040":"#070707"
};

const red = {
  "050":"#ffedea",
  "100":"#ffdbd6",
  "200":"#ffb7ae",
  "300":"#ff9187",
  "400":"#ff6762",
  "500":"#ff2e3f",
  "600":"#d52c36",
  "700":"#ad292e",
  "800":"#862425",
  "900":"#611e1d",
  "950":"#3e1715"
};

// Additional color scales: orange, yellow, green, mint,
// teal, cyan, blue, indigo, purple, pink, brown
// ... (same pattern as above)`,
  },
  options,
};

export const THEMING_PALETTE_ROLES: ThemingConstant = {
  href: `${THEME_REPO_BASE}/src/palette.ts`,
  file: {
    name: 'src/palette.ts',
    contents: `export type Roles = {
  bg: {
    editor: string;    // main editor background
    window: string;    // sidebar, activity bar, status bar
    inset: string;     // inputs, dropdowns
    elevated: string;  // panels, hover backgrounds
  };
  fg: {
    base: string;
    fg1: string;
    fg2: string;
    fg3: string;
    fg4: string;
  };
  border: {
    window: string;
    editor: string;
    indentGuide: string;
    indentGuideActive: string;
    inset: string;
    elevated: string;
  };
  accent: {
    primary: string;
    link: string;
    subtle: string;
    contrastOnAccent: string;
  };
  states: {
    merge: string;
    success: string;
    danger: string;
    warn: string;
    info: string;
  };
  syntax: {
    comment: string;
    string: string;
    number: string;
    keyword: string;
    regexp: string;
    func: string;
    type: string;
    variable: string;
    operator: string;
    punctuation: string;
    constant: string;
    parameter: string;
    namespace: string;
    decorator: string;
    escape: string;
    invalid: string;
    tag: string;
    attribute: string;
  };
  ansi: {
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
};`,
  },
  options,
};

export const THEMING_PALETTE_LIGHT: ThemingConstant = {
  href: `${THEME_REPO_BASE}/src/palette.ts`,
  file: {
    name: 'src/palette.ts',
    contents: `export const light: Roles = {
  bg: {
    editor: "#ffffff",
    window: gray["060"],
    inset: gray["080"],
    elevated: gray["040"]
  },
  fg: {
    base: gray["1040"],
    fg1: gray["900"],
    fg2: gray["800"],
    fg3: gray["600"],
    fg4: gray["500"]
  },
  border: {
    window: gray["100"],
    editor: gray["200"],
    indentGuide: gray["100"],
    indentGuideActive: gray["200"],
    inset: gray["200"],
    elevated: gray["100"]
  },
  accent: {
    primary: blue["500"],
    link: blue["500"],
    subtle: blue["100"],
    contrastOnAccent: "#ffffff"
  },
  states: {
    merge: indigo["500"],
    success: mint["500"],
    danger: red["500"],
    warn: yellow["500"],
    info: cyan["500"]
  },
  syntax: {
    comment: gray["600"],
    string: green["600"],
    number: cyan["600"],
    keyword: pink["500"],
    regexp: teal["600"],
    func: indigo["500"],
    type: purple["500"],
    variable: orange["600"],
    operator: cyan["500"],
    punctuation: gray["700"],
    constant: yellow["600"],
    parameter: gray["700"],
    namespace: yellow["600"],
    decorator: blue["500"],
    escape: cyan["600"],
    invalid: "#ffffff",
    tag: red["600"],
    attribute: mint["600"]
  },
  ansi: {
    black: gray["980"],
    red: red["500"],
    green: green["500"],
    yellow: yellow["500"],
    blue: blue["500"],
    magenta: purple["500"],
    cyan: cyan["500"],
    white: gray["300"],
    brightBlack: gray["980"],
    brightRed: red["500"],
    brightGreen: green["500"],
    brightYellow: yellow["500"],
    brightBlue: blue["500"],
    brightMagenta: purple["500"],
    brightCyan: cyan["500"],
    brightWhite: gray["300"]
  }
};`,
  },
  options,
};

export const THEMING_PALETTE_DARK: ThemingConstant = {
  href: `${THEME_REPO_BASE}/src/palette.ts`,
  file: {
    name: 'src/palette.ts',
    contents: `export const dark: Roles = {
  bg: {
    editor: gray["1040"],
    window: gray["1000"],
    inset: gray["980"],
    elevated: gray["1020"]
  },
  fg: {
    base: gray["020"],
    fg1: gray["200"],
    fg2: gray["400"],
    fg3: gray["600"],
    fg4: gray["700"]
  },
  border: {
    window: gray["1040"],
    editor: gray["920"],
    indentGuide: gray["940"],
    indentGuideActive: gray["960"],
    inset: gray["920"],
    elevated: gray["960"]
  },
  accent: {
    primary: blue["500"],
    link: blue["500"],
    subtle: blue["950"],
    contrastOnAccent: gray["1040"]
  },
  states: {
    merge: indigo["500"],
    success: mint["500"],
    danger: red["500"],
    warn: yellow["500"],
    info: cyan["500"]
  },
  syntax: {
    comment: gray["600"],
    string: green["400"],
    number: cyan["400"],
    keyword: pink["400"],
    regexp: teal["400"],
    func: indigo["400"],
    type: purple["400"],
    variable: orange["400"],
    operator: cyan["500"],
    punctuation: gray["700"],
    constant: yellow["400"],
    parameter: gray["400"],
    namespace: yellow["500"],
    decorator: blue["400"],
    escape: cyan["400"],
    invalid: "#ffffff",
    tag: red["400"],
    attribute: mint["400"]
  },
  ansi: {
    black: gray["1000"],
    red: red["500"],
    green: green["500"],
    yellow: yellow["500"],
    blue: blue["500"],
    magenta: purple["500"],
    cyan: cyan["500"],
    white: gray["300"],
    brightBlack: gray["1000"],
    brightRed: red["500"],
    brightGreen: green["500"],
    brightYellow: yellow["500"],
    brightBlue: blue["500"],
    brightMagenta: purple["500"],
    brightCyan: cyan["500"],
    brightWhite: gray["300"]
  }
};`,
  },
  options,
};

export const THEMING_TOKEN_COLORS_EXAMPLE: ThemingConstant = {
  href: `${THEME_REPO_BASE}/src/theme.ts`,
  file: {
    name: 'src/theme.ts',
    contents: `import type { Roles } from "./palette";

type VSCodeTheme = {
  name: string;
  type: "light" | "dark";
  colors: Record<string, string>;
  tokenColors: any[];
  semanticTokenColors: Record<string, string | { foreground: string; fontStyle?: string }>;
};

export function makeTheme(name: string, kind: "light" | "dark", c: Roles): VSCodeTheme {
  return {
    name,
    type: kind,
    colors: {
      // Core editor & text
      "editor.background": c.bg.editor,
      "editor.foreground": c.fg.base,
      "foreground": c.fg.base,
      "focusBorder": c.accent.primary,
      "selection.background": c.accent.subtle,

      // Editor chrome
      "editor.selectionBackground": alpha(c.accent.primary, kind === "dark" ? 0.30 : 0.18),
      "editor.lineHighlightBackground": alpha(c.accent.subtle, 0.55),
      "editorCursor.foreground": c.accent.primary,
      "editorLineNumber.foreground": c.fg.fg3,
      "editorLineNumber.activeForeground": c.fg.fg2,
      "editorIndentGuide.background": c.border.indentGuide,
      "editorIndentGuide.activeBackground": c.border.indentGuideActive,

      "diffEditor.insertedTextBackground": alpha(c.states.success, kind === "dark" ? 0.1 : 0.2),
      "diffEditor.deletedTextBackground": alpha(c.states.danger, kind === "dark" ? 0.1 : 0.2),

      // Sidebar
      "sideBar.background": c.bg.window,
      "sideBar.foreground": c.fg.fg2,
      "sideBar.border": c.border.window,
      "sideBarTitle.foreground": c.fg.base,
      "sideBarSectionHeader.background": c.bg.window,
      "sideBarSectionHeader.foreground": c.fg.fg2,
      "sideBarSectionHeader.border": c.border.window,

      // Activity bar
      "activityBar.background": c.bg.window,
      "activityBar.foreground": c.fg.base,
      "activityBar.border": c.border.window,
      "activityBar.activeBorder": c.accent.primary,
      "activityBarBadge.background": c.accent.primary,
      "activityBarBadge.foreground": c.accent.contrastOnAccent,

      // ... tabs, panels, status bar, inputs, buttons, git, terminal

    },

    tokenColors: [
      // COMMENTS
      { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: c.syntax.comment } },

      // STRINGS
      { scope: ["string", "constant.other.symbol"], settings: { foreground: c.syntax.string } },

      // NUMBERS & CONSTANTS
      { scope: ["constant.numeric", "constant.language.boolean"], settings: { foreground: c.syntax.number } },

      // KEYWORDS & STORAGE
      { scope: "keyword", settings: { foreground: c.syntax.keyword } },
      { scope: ["storage", "storage.type", "storage.modifier"], settings: { foreground: c.syntax.keyword } },

      // VARIABLES & IDENTIFIERS
      { scope: ["variable", "identifier", "meta.definition.variable"], settings: { foreground: c.syntax.variable } },
      { scope: "variable.parameter", settings: { foreground: c.syntax.parameter } },

      // FUNCTIONS & METHODS
      { scope: ["support.function", "entity.name.function"], settings: { foreground: c.syntax.func } },

      // TYPES & CLASSES
      { scope: ["support.type", "entity.name.type", "entity.name.class"], settings: { foreground: c.syntax.type } },

      // ... operators, punctuation, language-specific rules, CSS, HTML, Markdown, etc.
    ],

    semanticTokenColors: {
      comment: c.syntax.comment,
      string: c.syntax.string,
      number: c.syntax.number,
      keyword: c.syntax.keyword,
      variable: c.syntax.variable,
      parameter: c.syntax.parameter,
      function: c.syntax.func,
      type: c.syntax.type,
      class: c.syntax.type,
      namespace: c.syntax.namespace,
      // ...
    }
  };
}`,
  },
  options,
};

export const THEMING_PACKAGE_JSON_EXAMPLE: ThemingConstant = {
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
  "icon": "images/icon.png",
  "galleryBanner": {
    "color": "#1F1F21",
    "theme": "dark"
  },
  "keywords": ["theme", "color-theme", "dark", "light"],
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_USERNAME/my-custom-theme"
  },
  "homepage": "https://github.com/YOUR_USERNAME/my-custom-theme#readme",
  "bugs": {
    "url": "https://github.com/YOUR_USERNAME/my-custom-theme/issues"
  },
  "engines": {
    "vscode": "^1.60.0"
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

export const THEMING_REGISTER_THEME: ThemingConstant = {
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

export const THEMING_USE_IN_COMPONENT: ThemingConstant = {
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
