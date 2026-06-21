import { mkdirSync, writeFileSync } from 'node:fs';

import { convertRolesToP3 } from '../src/color';
import { createTheme } from '../src/createTheme';
import { createZedTheme } from '../src/createZedTheme';
import {
  dark as rolesDark,
  darkSoft as rolesDarkSoft,
  light as rolesLight,
  lightSoft as rolesLightSoft,
  protanDeutanDark as rolesProtanDeutanDark,
  protanDeutanLight as rolesProtanDeutanLight,
  tritanopiaDark as rolesTritanopiaDark,
  tritanopiaLight as rolesTritanopiaLight,
} from '../src/roles';

mkdirSync('themes', { recursive: true });
mkdirSync('zed/themes', { recursive: true });

// Convert palettes to Display P3 color space
const rolesLightP3 = convertRolesToP3(rolesLight);
const rolesDarkP3 = convertRolesToP3(rolesDark);

// ============================================
// VS Code Themes
// ============================================
const vscodeThemes = [
  {
    file: 'themes/pierre-light.json',
    theme: createTheme({
      name: 'pierre-light',
      displayName: 'Pierre Light',
      type: 'light',
      roles: rolesLight,
    }),
  },
  {
    file: 'themes/pierre-light-protanopia-deuteranopia.json',
    theme: createTheme({
      name: 'pierre-light-protanopia-deuteranopia',
      displayName: 'Pierre Light Protanopia & Deuteranopia',
      type: 'light',
      roles: rolesProtanDeutanLight,
    }),
  },
  {
    file: 'themes/pierre-light-soft.json',
    theme: createTheme({
      name: 'pierre-light-soft',
      displayName: 'Pierre Light Soft',
      type: 'light',
      roles: rolesLightSoft,
    }),
  },
  {
    file: 'themes/pierre-light-tritanopia.json',
    theme: createTheme({
      name: 'pierre-light-tritanopia',
      displayName: 'Pierre Light Tritanopia',
      type: 'light',
      roles: rolesTritanopiaLight,
    }),
  },
  {
    file: 'themes/pierre-light-vibrant.json',
    theme: createTheme({
      name: 'pierre-light-vibrant',
      displayName: 'Pierre Light Vibrant',
      type: 'light',
      roles: rolesLightP3,
    }),
  },
  {
    file: 'themes/pierre-dark.json',
    theme: createTheme({
      name: 'pierre-dark',
      displayName: 'Pierre Dark',
      type: 'dark',
      roles: rolesDark,
    }),
  },
  {
    file: 'themes/pierre-dark-protanopia-deuteranopia.json',
    theme: createTheme({
      name: 'pierre-dark-protanopia-deuteranopia',
      displayName: 'Pierre Dark Protanopia & Deuteranopia',
      type: 'dark',
      roles: rolesProtanDeutanDark,
    }),
  },
  {
    file: 'themes/pierre-dark-soft.json',
    theme: createTheme({
      name: 'pierre-dark-soft',
      displayName: 'Pierre Dark Soft',
      type: 'dark',
      roles: rolesDarkSoft,
    }),
  },
  {
    file: 'themes/pierre-dark-tritanopia.json',
    theme: createTheme({
      name: 'pierre-dark-tritanopia',
      displayName: 'Pierre Dark Tritanopia',
      type: 'dark',
      roles: rolesTritanopiaDark,
    }),
  },
  {
    file: 'themes/pierre-dark-vibrant.json',
    theme: createTheme({
      name: 'pierre-dark-vibrant',
      displayName: 'Pierre Dark Vibrant',
      type: 'dark',
      roles: rolesDarkP3,
    }),
  },
];

// oxfmt skips these files (.oxfmtrc.json), so append the trailing newline it
// would otherwise add.
for (const { file, theme } of vscodeThemes) {
  writeFileSync(file, JSON.stringify(theme, null, 2) + '\n', 'utf8');
  console.log('Wrote', file);
}

// ============================================
// Zed Theme Family
// ============================================
const zedTheme = createZedTheme('Pierre', 'pierrecomputer', [
  { name: 'Pierre Light', appearance: 'light', roles: rolesLight },
  {
    name: 'Pierre Light Protanopia & Deuteranopia',
    appearance: 'light',
    roles: rolesProtanDeutanLight,
  },
  { name: 'Pierre Light Soft', appearance: 'light', roles: rolesLightSoft },
  {
    name: 'Pierre Light Tritanopia',
    appearance: 'light',
    roles: rolesTritanopiaLight,
  },
  { name: 'Pierre Dark', appearance: 'dark', roles: rolesDark },
  {
    name: 'Pierre Dark Protanopia & Deuteranopia',
    appearance: 'dark',
    roles: rolesProtanDeutanDark,
  },
  { name: 'Pierre Dark Soft', appearance: 'dark', roles: rolesDarkSoft },
  {
    name: 'Pierre Dark Tritanopia',
    appearance: 'dark',
    roles: rolesTritanopiaDark,
  },
]);

writeFileSync(
  'zed/themes/pierre.json',
  JSON.stringify(zedTheme, null, 2) + '\n',
  'utf8'
);
console.log('Wrote zed/themes/pierre.json');

// ============================================
// ESM wrapper modules (for npm / Shiki consumers)
// ============================================
mkdirSync('dist', { recursive: true });

const themeNames: string[] = [];

/** VS Code / Shiki theme shape exposed by each per-theme module. */
const themeDts = `/** VS Code / TextMate theme object (frozen at runtime). */
interface PierreTheme {
  readonly name: string;
  readonly displayName: string;
  readonly type: "light" | "dark";
  readonly colors: Readonly<Record<string, string>>;
  readonly tokenColors: ReadonlyArray<{
    readonly name?: string;
    readonly scope?: string | string[];
    readonly settings: Readonly<Record<string, string>>;
  }>;
  readonly semanticTokenColors: Readonly<Record<string, string | Record<string, string>>>;
}

declare const theme: PierreTheme;
export default theme;
`;

for (const { file, theme } of vscodeThemes) {
  const name = file.replace('themes/', '').replace('.json', '');
  themeNames.push(name);
  const json = JSON.stringify(theme);
  const escaped = json.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const mjs = `export default Object.freeze(JSON.parse('${escaped}'))\n`;
  writeFileSync(`dist/${name}.mjs`, mjs, 'utf8');
  writeFileSync(`dist/${name}.d.mts`, themeDts, 'utf8');
  console.log('Wrote', `dist/${name}.mjs`, `+ .d.mts`);
}

const indexMjs = `export const themeNames = ${JSON.stringify(themeNames)}\n`;
const indexDts = `export declare const themeNames: readonly string[];\n`;
writeFileSync('dist/index.mjs', indexMjs, 'utf8');
writeFileSync('dist/index.d.mts', indexDts, 'utf8');
console.log('Wrote dist/index.mjs + .d.mts');
