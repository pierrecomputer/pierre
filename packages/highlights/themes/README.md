# Highlights themes

Highlights bundles themes matching all 65 IDs, names, and appearances in
[Shiki's catalog](https://github.com/shikijs/textmate-grammars-themes/blob/main/packages/tm-themes/index.js),
plus eight Pierre themes. All are Zed-format theme objects.

```js
import { codeToHtml } from '@pierre/highlights';
import { pierreDark, vitesseDark } from '@pierre/highlights/themes';

codeToHtml('const a = 1', { lang: 'js', theme: vitesseDark });
```

JSON filenames become camel-case exports: `vitesse-dark.json` → `vitesseDark`.
Pierre themes remain separate named exports.

Import one theme without loading the barrel through its default export:

```js
import vitesseDark from '@pierre/highlights/themes/vitesse-dark';
```

`themes` maps every JSON filename to one of these dynamic imports.

Use `toCSS` to convert a theme into CSS-variable declarations:

```js
import { toCSS, pierreDark } from '@pierre/highlights/themes';

toCSS(pierreDark);
// --cha-background: #0a0a0a;--cha-foreground: #fafafa;--cha-comment: #737373;...
```

Each community theme uses its Zed core, marketplace, or GitHub counterpart when
a suitable licensed port exists. The remaining themes are converted from Shiki's
pinned TextMate source with Zed's official scope mapping. Files retain `name`,
`appearance`, and the style keys Highlights and `@pierre/diffs` read; unrelated
editor UI colors are removed.

For CSS-controlled colors, use `cssVariables`. See [Themes](../README.md#themes)
for the accepted properties and
[third-party licenses](./THIRD_PARTY_LICENSES.md) for pinned sources and Zed
marketplace versions.

## Shiki catalog themes

| Theme                        | Name                       | Appearance | Source              |
| ---------------------------- | -------------------------- | ---------- | ------------------- |
| `andromeeda`                 | Andromeeda                 | dark       | Zed port            |
| `aurora-x`                   | Aurora X                   | dark       | Zed substitute      |
| `ayu-dark`                   | Ayu Dark                   | dark       | Zed port            |
| `ayu-light`                  | Ayu Light                  | light      | Zed port            |
| `ayu-mirage`                 | Ayu Mirage                 | dark       | Zed port            |
| `catppuccin-frappe`          | Catppuccin Frappé          | dark       | Zed port            |
| `catppuccin-latte`           | Catppuccin Latte           | light      | Zed port            |
| `catppuccin-macchiato`       | Catppuccin Macchiato       | dark       | Zed port            |
| `catppuccin-mocha`           | Catppuccin Mocha           | dark       | Zed port            |
| `dark-plus`                  | Dark Plus                  | dark       | Zed port            |
| `dracula`                    | Dracula Theme              | dark       | Zed port            |
| `dracula-soft`               | Dracula Theme Soft         | dark       | TextMate conversion |
| `everforest-dark`            | Everforest Dark            | dark       | Zed port            |
| `everforest-light`           | Everforest Light           | light      | Zed port            |
| `github-dark`                | GitHub Dark                | dark       | Zed port            |
| `github-dark-default`        | GitHub Dark Default        | dark       | Zed port            |
| `github-dark-dimmed`         | GitHub Dark Dimmed         | dark       | Zed port            |
| `github-dark-high-contrast`  | GitHub Dark High Contrast  | dark       | Zed port            |
| `github-light`               | GitHub Light               | light      | Zed port            |
| `github-light-default`       | GitHub Light Default       | light      | Zed port            |
| `github-light-high-contrast` | GitHub Light High Contrast | light      | Zed port            |
| `gruvbox-dark-hard`          | Gruvbox Dark Hard          | dark       | Zed port            |
| `gruvbox-dark-medium`        | Gruvbox Dark Medium        | dark       | Zed port            |
| `gruvbox-dark-soft`          | Gruvbox Dark Soft          | dark       | Zed port            |
| `gruvbox-light-hard`         | Gruvbox Light Hard         | light      | Zed port            |
| `gruvbox-light-medium`       | Gruvbox Light Medium       | light      | Zed port            |
| `gruvbox-light-soft`         | Gruvbox Light Soft         | light      | Zed port            |
| `horizon`                    | Horizon                    | dark       | Zed port            |
| `horizon-bright`             | Horizon Bright             | light      | Zed port            |
| `houston`                    | Houston                    | dark       | Zed port            |
| `kanagawa-dragon`            | Kanagawa Dragon            | dark       | Zed port            |
| `kanagawa-lotus`             | Kanagawa Lotus             | light      | Zed port            |
| `kanagawa-wave`              | Kanagawa Wave              | dark       | Zed port            |
| `laserwave`                  | LaserWave                  | dark       | TextMate conversion |
| `light-plus`                 | Light Plus                 | light      | Zed port            |
| `material-theme`             | Material Theme             | dark       | Zed port            |
| `material-theme-darker`      | Material Theme Darker      | dark       | Zed port            |
| `material-theme-lighter`     | Material Theme Lighter     | light      | Zed port            |
| `material-theme-ocean`       | Material Theme Ocean       | dark       | Zed port            |
| `material-theme-palenight`   | Material Theme Palenight   | dark       | Zed port            |
| `min-dark`                   | Min Dark                   | dark       | Zed port            |
| `min-light`                  | Min Light                  | light      | Zed port            |
| `monokai`                    | Monokai                    | dark       | Zed port            |
| `night-owl`                  | Night Owl                  | dark       | Zed port            |
| `night-owl-light`            | Night Owl Light            | light      | Zed port            |
| `nord`                       | Nord                       | dark       | Zed port            |
| `one-dark-pro`               | One Dark Pro               | dark       | Zed port            |
| `one-light`                  | One Light                  | light      | Zed port            |
| `plastic`                    | Plastic                    | dark       | Zed port            |
| `poimandres`                 | Poimandres                 | dark       | TextMate conversion |
| `red`                        | Red                        | dark       | Zed port            |
| `rose-pine`                  | Rosé Pine                  | dark       | Zed port            |
| `rose-pine-dawn`             | Rosé Pine Dawn             | light      | Zed port            |
| `rose-pine-moon`             | Rosé Pine Moon             | dark       | Zed port            |
| `slack-dark`                 | Slack Dark                 | dark       | TextMate conversion |
| `slack-ochin`                | Slack Ochin                | light      | TextMate conversion |
| `snazzy-light`               | Snazzy Light               | light      | Zed port            |
| `solarized-dark`             | Solarized Dark             | dark       | Zed port            |
| `solarized-light`            | Solarized Light            | light      | Zed port            |
| `synthwave-84`               | Synthwave '84              | dark       | Zed port            |
| `tokyo-night`                | Tokyo Night                | dark       | Zed port            |
| `vesper`                     | Vesper                     | dark       | Zed port            |
| `vitesse-black`              | Vitesse Black              | dark       | Zed port            |
| `vitesse-dark`               | Vitesse Dark               | dark       | Zed port            |
| `vitesse-light`              | Vitesse Light              | light      | Zed port            |

## Pierre themes

| Theme                     | Name                                   | Appearance |
| ------------------------- | -------------------------------------- | ---------- |
| `pierre-dark`             | Pierre Dark                            | dark       |
| `pierre-dark-protanopia`  | Pierre Dark Protanopia & Deuteranopia  | dark       |
| `pierre-dark-soft`        | Pierre Dark Soft                       | dark       |
| `pierre-dark-tritanopia`  | Pierre Dark Tritanopia                 | dark       |
| `pierre-light`            | Pierre Light                           | light      |
| `pierre-light-protanopia` | Pierre Light Protanopia & Deuteranopia | light      |
| `pierre-light-soft`       | Pierre Light Soft                      | light      |
| `pierre-light-tritanopia` | Pierre Light Tritanopia                | light      |
