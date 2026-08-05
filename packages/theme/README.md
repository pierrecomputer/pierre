PIERRE COMPUTER COMPANY █ PROJECT: THEME

```

CONTACT: SUPPORT@PIERRE.CO
LOCATION: USA
STATUS: ONLINE
OPEN POSITIONS: [Systems Engineer](https://pierre.computer/careers/systems-engineer)

```

Overview:

- Light and dark themes for Visual Studio Code, Cursor, Zed, and Shiki.
- Built for [Diffs.com](https://diffs.com)

```

Usage:

 VS Code / Cursor:
  1. Install "Pierre Theme" from the Extensions marketplace
  2. Cmd+Shift+P > "Color Theme" > select Pierre Light or Pierre Dark

 Shiki / npm:
  npm install @pierre/theme

  import pierreDark from '@pierre/theme/pierre-dark'
  import pierreLight from '@pierre/theme/pierre-light'

  Available themes:
   - @pierre/theme/pierre-light
   - @pierre/theme/pierre-light-soft
   - @pierre/theme/pierre-light-protanopia-deuteranopia  (CVD, red-green)
   - @pierre/theme/pierre-light-tritanopia               (CVD, blue-yellow)
   - @pierre/theme/pierre-light-vibrant                  (Display P3)
   - @pierre/theme/pierre-dark
   - @pierre/theme/pierre-dark-soft
   - @pierre/theme/pierre-dark-protanopia-deuteranopia   (CVD, red-green)
   - @pierre/theme/pierre-dark-tritanopia                (CVD, blue-yellow)
   - @pierre/theme/pierre-dark-vibrant                   (Display P3)

 Zed:
  Install "Pierre" from the Zed extension registry

 Figma:
  Variables ship as DTCG design tokens under figma/

  1. Variables view > create a collection named exactly "Pierre Primitives",
     then drag in figma/primitives.json
  2. Create a second collection, then drag in all of figma/semantic/*.json
     together — each file becomes a mode, and its values link back to the
     primitives collection from step 1
  3. Drag light.json in first so Light lands in the left-most column and
     becomes the collection's default mode

  The Vibrant variants are not exported: Figma imports sRGB and HSL only.

  To syntax highlight code in a Figma text layer with these variables, see
  the Diffs Highlight plugin in packages/diffs-highlight

```

## Agent skill

Install the agent skill for this package with the
[Skills CLI](https://skills.sh/docs/cli):

```bash
npx skills add pierrecomputer/pierre --skill theme
```

Contributing:

- Development, build, and testing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Accessibility (CVD themes): [ACCESSIBILITY.md](ACCESSIBILITY.md)
