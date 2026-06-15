# Pierre Theme

Light and dark themes for Visual Studio Code, Cursor, Zed, and Shiki. Built for
[Diffs.com](https://diffs.com) by
[The Pierre Computer Company](https://pierre.computer).

## Preview

![Pierre dark theme screenshot](https://github.com/user-attachments/assets/e8b2a6e0-995b-4515-997a-f805f4fbc5bf)
![Pierre light theme screenshot](https://github.com/user-attachments/assets/2ebb09d0-eb42-4c28-9617-35873d96ed8f)

## Install

### Visual Studio Code

From the menu in Visual Studio Code:

- View > Extensions (or hit Command+Shift+X or Control+Shift+X)
- Search for `Pierre Theme`
- Click install

You can also install or download from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=pierrecomputer.pierre-theme).

### Cursor

From the menu in Cursor:

- View > Extensions (or hit Command+Shift+X or Control+Shift+X)
- Search for `Pierre Theme`
- Click install

You can also install or download from the
[Open VSX registry](https://open-vsx.org/extension/pierrecomputer/pierre-theme).

### Zed

From the menu in Zed:

- Zed > Extensions (or hit Command+Shift+X or Control+Shift+X)
- Search for `Pierre`
- Click install

## Vibrant themes (Display P3)

> [!NOTE] Vibrant themes do not work in VS Code or Cursor at this time as it
> does not support color formats other than Hex or RGB. You can, however, use
> these with [Diffs](https://diffs.com) or any [Shiki](https://shiki.style)
> project to render code.

The **Vibrant** theme variants use CSS's `color(display-p3 r g b)` format with
enhanced saturation to fully utilize Display P3's wider color gamut. Display P3
can represent ~25% more colors than standard sRGB, and these themes are
optimized to take full advantage of that on compatible displays.

The conversion algorithm transforms sRGB colors to Display P3 through proper
linear color space transformations, then enhances saturation (15-30%) and
luminance (5% for vibrant colors) to push colors into the wider P3 gamut that
isn't accessible in sRGB.

## Override

To override this (or any other) theme in your personal config file, please
follow the guide in the
[color theme](https://code.visualstudio.com/api/extension-guides/color-theme)
documentation. This is handy for small tweaks to the theme without having to
fork and maintain your own theme.

## Contribute

1. Clone and open this [repo](https://github.com/pierrecomputer/pierre) in your
   editor
2. Run `bun install` from the repository root to install the dependencies.
3. Press `F5` to open a new window with your extension loaded
4. Open `Code > Preferences > Color Theme` [`⌘k ⌘t`] and pick the "Pierre…"
   theme you want to test.
5. Make changes under `packages/theme/src`. Theme construction lives in
   `src/createTheme.ts`; role values live in `src/roles`.
6. Run `moonx theme:build` to update the theme. You can also run
   `moonx theme:dev --ignore-ci-checks` to automatically rebuild the themes
   while making changes.
7. Run `moonx theme:test` to validate your changes; see [Testing](#testing)
   below.
8. Once you're happy, commit your changes and open a PR.

## Testing

`moonx theme:test` builds the themes, runs structural validation, and runs the
CVD accessibility gate (the design it enforces is documented in
[`ACCESSIBILITY.md`](ACCESSIBILITY.md)). The gate lives in `test/`.

For visual proofing, `moonx theme:preview --ignore-ci-checks` writes
`preview/*.html`: the palette scales, the Display-P3 conversions, and a
normal-vs-simulated CVD proof sheet.

## Scripts

| Script                                        | Description                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `moonx theme:build`                           | Builds the theme `.json` files in `./themes` and ESM modules in `./dist`                                |
| `moonx theme:test`                            | Runs validation tests + the CVD accessibility gate after build                                          |
| `moonx theme:preview --ignore-ci-checks`      | Writes preview HTML files from `src/previews` into `preview/`                                           |
| `moonx theme:package-vsix --ignore-ci-checks` | Temporarily applies the VSIX package name/README shim, then writes the `.vsix` file at the project root |
| `moonx theme:dev --ignore-ci-checks`          | Rebuilds themes on file change                                                                          |

## Credit

This theme was built on top of
[GitHub's Visual Studio Code Theme](https://github.com/primer/github-vscode-theme).
All credit to them for the technique and build tooling, which we've since
iterated on for more specific language tokens.
