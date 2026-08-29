# chamele community themes

69 [Zed-format themes](https://zed.dev/docs/extensions/themes), bundled as named
exports.

```js
import { codeToHtml } from 'chamele';
import { pierreDark, pierreLight } from 'chamele/themes';

codeToHtml('const a = 1', { lang: 'js', theme: pierreDark });
```

JSON filenames become camel-case exports: `atom-one-dark.json` → `atomOneDark`.

Use `toCSS` to convert a theme into CSS-variable declarations:

```js
import { toCSS, pierreDark } from 'chamele/themes';

toCSS(pierreDark);
// --cha-background: #0a0a0a;--cha-foreground: #fafafa;--cha-comment: #737373;--cha-comment-doc: #737373;...
```

Each file keeps `name`, `appearance`, and the `style` keys read by chamele:
`background`, `foreground`, `text`, `editor.background`, `editor.foreground`,
`syntax`, and the editor-chrome keys consumers like `@pierre/diffs` read
(`editor.active_line.background`,
`editor.document_highlight.bracket_background`, `search.match_background`, the
first `players` entry, `error`, `warning`, `info`, `hint`). Other UI-only colors
are removed. `codeToHtml` also accepts full Zed themes and theme families.

For CSS-controlled colors, use the variable theme:

```js
import { cssVariables } from 'chamele/themes';
```

See [Themes](../README.md#themes) for its properties and
[third-party licenses](./THIRD_PARTY_LICENSES.md) for theme sources and
licenses.

## Bundled themes

| Theme                             | name                                   | Appearance |
| --------------------------------- | -------------------------------------- | ---------- |
| `atom-one-dark`                   | Atom One Dark                          | dark       |
| `atom-one-light`                  | Atom One Light                         | light      |
| `catppuccin-frappe-dark`          | Catppuccin Frappé                      | dark       |
| `catppuccin-latte-light`          | Catppuccin Latte                       | light      |
| `catppuccin-macchiato-dark`       | Catppuccin Macchiato                   | dark       |
| `catppuccin-mocha-dark`           | Catppuccin Mocha                       | dark       |
| `dracula-alucard-light`           | Dracula Light (Alucard)                | light      |
| `dracula-dark`                    | Dracula                                | dark       |
| `dracula-solid-dark`              | Dracula Solid                          | dark       |
| `github-colorblind-dark`          | GitHub Dark Colorblind                 | dark       |
| `github-colorblind-light`         | GitHub Light Colorblind                | light      |
| `github-dark`                     | GitHub Dark                            | dark       |
| `github-dimmed-dark`              | GitHub Dark Dimmed                     | dark       |
| `github-high-contrast-dark`       | GitHub Dark High Contrast              | dark       |
| `github-high-contrast-light`      | GitHub Light High Contrast             | light      |
| `github-light`                    | GitHub Light                           | light      |
| `github-tritanopia-dark`          | GitHub Dark Tritanopia                 | dark       |
| `github-tritanopia-light`         | GitHub Light Tritanopia                | light      |
| `monokai-dark`                    | Monokai                                | dark       |
| `monokai-one-dark`                | One Monokai                            | dark       |
| `monokai-solarized-dark`          | Monokai Solarized                      | dark       |
| `monokai-st3-dark`                | Monokai-ST3                            | dark       |
| `night-owl-dark`                  | Night Owl Dark                         | dark       |
| `night-owl-light`                 | Night Owl Light                        | light      |
| `nord-dark`                       | Nord Dark                              | dark       |
| `nord-darker-dark`                | Nord Darker                            | dark       |
| `nord-light`                      | Nord Light                             | light      |
| `one-dark`                        | One Dark                               | dark       |
| `one-light`                       | One Light                              | light      |
| `pierre-dark`                     | Pierre Dark                            | dark       |
| `pierre-dark-protanopia`          | Pierre Dark Protanopia & Deuteranopia  | dark       |
| `pierre-dark-soft`                | Pierre Dark Soft                       | dark       |
| `pierre-dark-tritanopia`          | Pierre Dark Tritanopia                 | dark       |
| `pierre-light`                    | Pierre Light                           | light      |
| `pierre-light-protanopia`         | Pierre Light Protanopia & Deuteranopia | light      |
| `pierre-light-soft`               | Pierre Light Soft                      | light      |
| `pierre-light-tritanopia`         | Pierre Light Tritanopia                | light      |
| `sonokai-andromeda-dark`          | Sonokai Andromeda                      | dark       |
| `sonokai-atlantis-dark`           | Sonokai Atlantis                       | dark       |
| `sonokai-dark`                    | Sonokai                                | dark       |
| `sonokai-espresso-dark`           | Sonokai Espresso                       | dark       |
| `sonokai-maia-dark`               | Sonokai Maia                           | dark       |
| `sonokai-shusia-dark`             | Sonokai Shusia                         | dark       |
| `tokyo-night-dark`                | Tokyo Night                            | dark       |
| `tokyo-night-light`               | Tokyo Night Light                      | light      |
| `tokyo-night-moon-dark`           | Tokyo Night Moon                       | dark       |
| `tokyo-night-storm-dark`          | Tokyo Night Storm                      | dark       |
| `vesper-dark`                     | Vesper                                 | dark       |
| `vesper-light`                    | Vesper Light                           | light      |
| `vesper-orange-dark`              | Vesper Orange (Peppermint)             | dark       |
| `vscode-2026-dark`                | Dark 2026 (VS Code)                    | dark       |
| `vscode-2026-light`               | Light 2026 (VS Code)                   | light      |
| `vscode-abyss-dark`               | Abyss (VS Code)                        | dark       |
| `vscode-high-contrast-dark`       | High Contrast Dark (VS Code)           | dark       |
| `vscode-high-contrast-light`      | High Contrast Light (VS Code)          | light      |
| `vscode-kimbie-dark`              | Kimbie Dark (VS Code)                  | dark       |
| `vscode-modern-dark`              | Dark Modern (VS Code)                  | dark       |
| `vscode-modern-light`             | Light Modern (VS Code)                 | light      |
| `vscode-monokai-dark`             | Monokai (VS Code)                      | dark       |
| `vscode-monokai-dimmed-dark`      | Monokai Dimmed (VS Code)               | dark       |
| `vscode-plus-dark`                | Dark+ (VS Code)                        | dark       |
| `vscode-plus-light`               | Light+ (VS Code)                       | light      |
| `vscode-quiet-light`              | Quiet Light (VS Code)                  | light      |
| `vscode-red-dark`                 | Red (VS Code)                          | dark       |
| `vscode-solarized-dark`           | Solarized Dark (VS Code)               | dark       |
| `vscode-solarized-light`          | Solarized Light (VS Code)              | light      |
| `vscode-tomorrow-night-blue-dark` | Tomorrow Night Blue (VS Code)          | dark       |
| `vscode-visual-studio-dark`       | Visual Studio Dark (VS Code)           | dark       |
| `vscode-visual-studio-light`      | Visual Studio Light (VS Code)          | light      |
