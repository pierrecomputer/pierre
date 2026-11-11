import type { Theme, ThemedToken } from '../lib/core';
import {
  ansiNames,
  defaultCssVariablePrefix,
  isThemeColor,
  resolveThemeSyntax,
  themeAnsiColors,
  themeBackground,
  themeForeground,
} from '../lib/theme';
import tokenTypes from '../lib/token-types';
import andromeedaJson from './andromeeda.json' with { type: 'json' };
import auroraXJson from './aurora-x.json' with { type: 'json' };
import ayuDarkJson from './ayu-dark.json' with { type: 'json' };
import ayuLightJson from './ayu-light.json' with { type: 'json' };
import ayuMirageJson from './ayu-mirage.json' with { type: 'json' };
import catppuccinFrappeJson from './catppuccin-frappe.json' with { type: 'json' };
import catppuccinLatteJson from './catppuccin-latte.json' with { type: 'json' };
import catppuccinMacchiatoJson from './catppuccin-macchiato.json' with { type: 'json' };
import catppuccinMochaJson from './catppuccin-mocha.json' with { type: 'json' };
import darkPlusJson from './dark-plus.json' with { type: 'json' };
import draculaSoftJson from './dracula-soft.json' with { type: 'json' };
import draculaJson from './dracula.json' with { type: 'json' };
import everforestDarkJson from './everforest-dark.json' with { type: 'json' };
import everforestLightJson from './everforest-light.json' with { type: 'json' };
import githubDarkDefaultJson from './github-dark-default.json' with { type: 'json' };
import githubDarkDimmedJson from './github-dark-dimmed.json' with { type: 'json' };
import githubDarkHighContrastJson from './github-dark-high-contrast.json' with { type: 'json' };
import githubDarkJson from './github-dark.json' with { type: 'json' };
import githubLightDefaultJson from './github-light-default.json' with { type: 'json' };
import githubLightHighContrastJson from './github-light-high-contrast.json' with { type: 'json' };
import githubLightJson from './github-light.json' with { type: 'json' };
import gruvboxDarkHardJson from './gruvbox-dark-hard.json' with { type: 'json' };
import gruvboxDarkMediumJson from './gruvbox-dark-medium.json' with { type: 'json' };
import gruvboxDarkSoftJson from './gruvbox-dark-soft.json' with { type: 'json' };
import gruvboxLightHardJson from './gruvbox-light-hard.json' with { type: 'json' };
import gruvboxLightMediumJson from './gruvbox-light-medium.json' with { type: 'json' };
import gruvboxLightSoftJson from './gruvbox-light-soft.json' with { type: 'json' };
import horizonBrightJson from './horizon-bright.json' with { type: 'json' };
import horizonJson from './horizon.json' with { type: 'json' };
import houstonJson from './houston.json' with { type: 'json' };
import kanagawaDragonJson from './kanagawa-dragon.json' with { type: 'json' };
import kanagawaLotusJson from './kanagawa-lotus.json' with { type: 'json' };
import kanagawaWaveJson from './kanagawa-wave.json' with { type: 'json' };
import laserwaveJson from './laserwave.json' with { type: 'json' };
import lightPlusJson from './light-plus.json' with { type: 'json' };
import materialThemeDarkerJson from './material-theme-darker.json' with { type: 'json' };
import materialThemeLighterJson from './material-theme-lighter.json' with { type: 'json' };
import materialThemeOceanJson from './material-theme-ocean.json' with { type: 'json' };
import materialThemePalenightJson from './material-theme-palenight.json' with { type: 'json' };
import materialThemeJson from './material-theme.json' with { type: 'json' };
import minDarkJson from './min-dark.json' with { type: 'json' };
import minLightJson from './min-light.json' with { type: 'json' };
import monokaiJson from './monokai.json' with { type: 'json' };
import nightOwlLightJson from './night-owl-light.json' with { type: 'json' };
import nightOwlJson from './night-owl.json' with { type: 'json' };
import nordJson from './nord.json' with { type: 'json' };
import oneDarkProJson from './one-dark-pro.json' with { type: 'json' };
import oneLightJson from './one-light.json' with { type: 'json' };
import pierreDarkProtanopiaDeuteranopiaJson from './pierre-dark-protanopia-deuteranopia.json' with { type: 'json' };
import pierreDarkSoftJson from './pierre-dark-soft.json' with { type: 'json' };
import pierreDarkTritanopiaJson from './pierre-dark-tritanopia.json' with { type: 'json' };
import pierreDarkVibrantJson from './pierre-dark-vibrant.json' with { type: 'json' };
import pierreDarkJson from './pierre-dark.json' with { type: 'json' };
import pierreLightProtanopiaDeuteranopiaJson from './pierre-light-protanopia-deuteranopia.json' with { type: 'json' };
import pierreLightSoftJson from './pierre-light-soft.json' with { type: 'json' };
import pierreLightTritanopiaJson from './pierre-light-tritanopia.json' with { type: 'json' };
import pierreLightVibrantJson from './pierre-light-vibrant.json' with { type: 'json' };
import pierreLightJson from './pierre-light.json' with { type: 'json' };
import plasticJson from './plastic.json' with { type: 'json' };
import poimandresJson from './poimandres.json' with { type: 'json' };
import redJson from './red.json' with { type: 'json' };
import rosePineDawnJson from './rose-pine-dawn.json' with { type: 'json' };
import rosePineMoonJson from './rose-pine-moon.json' with { type: 'json' };
import rosePineJson from './rose-pine.json' with { type: 'json' };
import slackDarkJson from './slack-dark.json' with { type: 'json' };
import slackOchinJson from './slack-ochin.json' with { type: 'json' };
import snazzyLightJson from './snazzy-light.json' with { type: 'json' };
import solarizedDarkJson from './solarized-dark.json' with { type: 'json' };
import solarizedLightJson from './solarized-light.json' with { type: 'json' };
import synthwave84Json from './synthwave-84.json' with { type: 'json' };
import tokyoNightJson from './tokyo-night.json' with { type: 'json' };
import vesperJson from './vesper.json' with { type: 'json' };
import vitesseBlackJson from './vitesse-black.json' with { type: 'json' };
import vitesseDarkJson from './vitesse-dark.json' with { type: 'json' };
import vitesseLightJson from './vitesse-light.json' with { type: 'json' };

/** A pass-through theme: every color resolves to a prefixed CSS variable. */
export const cssVariables: Theme = {
  name: 'CSS Variables',
  appearance: 'dark',
  cssVariables: true,
  style: {},
};

/**
 * Convert a Zed theme to CSS custom properties.
 * Emit only hex and numeric Display P3 colors. Omit invalid background
 * and foreground colors. Use `inherit` for invalid syntax colors.
 * Skip syntax scopes whose names are not plain dotted identifiers.
 * The 16 `terminal-ansi-*` colors use VS Code's terminal colors when missing.
 */
export function toCSS(
  { style }: Theme,
  {
    cssVariablePrefix = defaultCssVariablePrefix,
    fontStyle = false,
  }: {
    cssVariablePrefix?: string;
    fontStyle?: boolean;
  } = {}
): string {
  let css = '';
  if (style == null) return css;
  const background = themeBackground(style);
  const foreground = themeForeground(style);
  if (isThemeColor(background)) {
    css += `${cssVariablePrefix}background: ${background.trim()};`;
  }
  if (isThemeColor(foreground)) {
    css += `${cssVariablePrefix}foreground: ${foreground.trim()};`;
  }
  const syntax = style.syntax ?? {};
  for (const name of new Set([
    ...Object.keys(syntax),
    ...tokenTypes.slice(1, -2),
  ])) {
    if (!/^[a-z0-9_.-]+$/i.test(name)) continue;
    const settings = resolveThemeSyntax(syntax, name);
    const color = settings?.color ?? foreground;
    const variable = cssVariablePrefix + name.replace(/[._]/g, '-');
    css += `${variable}: ${isThemeColor(color) ? color.trim() : 'inherit'};`;
    if (fontStyle)
      css += `${variable}-font-style: ${settings?.font_style === 'italic' ? 'italic' : 'normal'};`;
  }
  const ansi = themeAnsiColors(style);
  for (let i = 0; i < ansi.length; i++) {
    css += `${cssVariablePrefix}terminal-ansi-${ansiNames[i].replace('_', '-')}: ${ansi[i]};`;
  }
  return css;
}

/** Return the font-style variable for a token from the `cssVariables` theme. */
export function getFontStyle(token: ThemedToken): string | undefined {
  if (token.color?.startsWith('var(') === true) {
    return token.color.slice(0, -1) + '-font-style)';
  }
  return undefined;
}

export const andromeeda: Theme = /* @__PURE__ */ Object.assign(
  { id: 'andromeeda' },
  andromeedaJson
);
export const auroraX: Theme = /* @__PURE__ */ Object.assign(
  { id: 'aurora-x' },
  auroraXJson
);
export const ayuDark: Theme = /* @__PURE__ */ Object.assign(
  { id: 'ayu-dark' },
  ayuDarkJson
);
export const ayuLight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'ayu-light' },
  ayuLightJson
);
export const ayuMirage: Theme = /* @__PURE__ */ Object.assign(
  { id: 'ayu-mirage' },
  ayuMirageJson
);
export const catppuccinFrappe: Theme = /* @__PURE__ */ Object.assign(
  { id: 'catppuccin-frappe' },
  catppuccinFrappeJson
);
export const catppuccinLatte: Theme = /* @__PURE__ */ Object.assign(
  { id: 'catppuccin-latte' },
  catppuccinLatteJson
);
export const catppuccinMacchiato: Theme = /* @__PURE__ */ Object.assign(
  { id: 'catppuccin-macchiato' },
  catppuccinMacchiatoJson
);
export const catppuccinMocha: Theme = /* @__PURE__ */ Object.assign(
  { id: 'catppuccin-mocha' },
  catppuccinMochaJson
);
export const darkPlus: Theme = /* @__PURE__ */ Object.assign(
  { id: 'dark-plus' },
  darkPlusJson
);
export const dracula: Theme = /* @__PURE__ */ Object.assign(
  { id: 'dracula' },
  draculaJson
);
export const draculaSoft: Theme = /* @__PURE__ */ Object.assign(
  { id: 'dracula-soft' },
  draculaSoftJson
);
export const everforestDark: Theme = /* @__PURE__ */ Object.assign(
  { id: 'everforest-dark' },
  everforestDarkJson
);
export const everforestLight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'everforest-light' },
  everforestLightJson
);
export const githubDark: Theme = /* @__PURE__ */ Object.assign(
  { id: 'github-dark' },
  githubDarkJson
);
export const githubDarkDefault: Theme = /* @__PURE__ */ Object.assign(
  { id: 'github-dark-default' },
  githubDarkDefaultJson
);
export const githubDarkDimmed: Theme = /* @__PURE__ */ Object.assign(
  { id: 'github-dark-dimmed' },
  githubDarkDimmedJson
);
export const githubDarkHighContrast: Theme = /* @__PURE__ */ Object.assign(
  { id: 'github-dark-high-contrast' },
  githubDarkHighContrastJson
);
export const githubLight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'github-light' },
  githubLightJson
);
export const githubLightDefault: Theme = /* @__PURE__ */ Object.assign(
  { id: 'github-light-default' },
  githubLightDefaultJson
);
export const githubLightHighContrast: Theme = /* @__PURE__ */ Object.assign(
  { id: 'github-light-high-contrast' },
  githubLightHighContrastJson
);
export const gruvboxDarkHard: Theme = /* @__PURE__ */ Object.assign(
  { id: 'gruvbox-dark-hard' },
  gruvboxDarkHardJson
);
export const gruvboxDarkMedium: Theme = /* @__PURE__ */ Object.assign(
  { id: 'gruvbox-dark-medium' },
  gruvboxDarkMediumJson
);
export const gruvboxDarkSoft: Theme = /* @__PURE__ */ Object.assign(
  { id: 'gruvbox-dark-soft' },
  gruvboxDarkSoftJson
);
export const gruvboxLightHard: Theme = /* @__PURE__ */ Object.assign(
  { id: 'gruvbox-light-hard' },
  gruvboxLightHardJson
);
export const gruvboxLightMedium: Theme = /* @__PURE__ */ Object.assign(
  { id: 'gruvbox-light-medium' },
  gruvboxLightMediumJson
);
export const gruvboxLightSoft: Theme = /* @__PURE__ */ Object.assign(
  { id: 'gruvbox-light-soft' },
  gruvboxLightSoftJson
);
export const horizon: Theme = /* @__PURE__ */ Object.assign(
  { id: 'horizon' },
  horizonJson
);
export const horizonBright: Theme = /* @__PURE__ */ Object.assign(
  { id: 'horizon-bright' },
  horizonBrightJson
);
export const houston: Theme = /* @__PURE__ */ Object.assign(
  { id: 'houston' },
  houstonJson
);
export const kanagawaDragon: Theme = /* @__PURE__ */ Object.assign(
  { id: 'kanagawa-dragon' },
  kanagawaDragonJson
);
export const kanagawaLotus: Theme = /* @__PURE__ */ Object.assign(
  { id: 'kanagawa-lotus' },
  kanagawaLotusJson
);
export const kanagawaWave: Theme = /* @__PURE__ */ Object.assign(
  { id: 'kanagawa-wave' },
  kanagawaWaveJson
);
export const laserwave: Theme = /* @__PURE__ */ Object.assign(
  { id: 'laserwave' },
  laserwaveJson
);
export const lightPlus: Theme = /* @__PURE__ */ Object.assign(
  { id: 'light-plus' },
  lightPlusJson
);
export const materialTheme: Theme = /* @__PURE__ */ Object.assign(
  { id: 'material-theme' },
  materialThemeJson
);
export const materialThemeDarker: Theme = /* @__PURE__ */ Object.assign(
  { id: 'material-theme-darker' },
  materialThemeDarkerJson
);
export const materialThemeLighter: Theme = /* @__PURE__ */ Object.assign(
  { id: 'material-theme-lighter' },
  materialThemeLighterJson
);
export const materialThemeOcean: Theme = /* @__PURE__ */ Object.assign(
  { id: 'material-theme-ocean' },
  materialThemeOceanJson
);
export const materialThemePalenight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'material-theme-palenight' },
  materialThemePalenightJson
);
export const minDark: Theme = /* @__PURE__ */ Object.assign(
  { id: 'min-dark' },
  minDarkJson
);
export const minLight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'min-light' },
  minLightJson
);
export const monokai: Theme = /* @__PURE__ */ Object.assign(
  { id: 'monokai' },
  monokaiJson
);
export const nightOwl: Theme = /* @__PURE__ */ Object.assign(
  { id: 'night-owl' },
  nightOwlJson
);
export const nightOwlLight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'night-owl-light' },
  nightOwlLightJson
);
export const nord: Theme = /* @__PURE__ */ Object.assign(
  { id: 'nord' },
  nordJson
);
export const oneDarkPro: Theme = /* @__PURE__ */ Object.assign(
  { id: 'one-dark-pro' },
  oneDarkProJson
);
export const oneLight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'one-light' },
  oneLightJson
);
export const plastic: Theme = /* @__PURE__ */ Object.assign(
  { id: 'plastic' },
  plasticJson
);
export const poimandres: Theme = /* @__PURE__ */ Object.assign(
  { id: 'poimandres' },
  poimandresJson
);
export const red: Theme = /* @__PURE__ */ Object.assign({ id: 'red' }, redJson);
export const rosePine: Theme = /* @__PURE__ */ Object.assign(
  { id: 'rose-pine' },
  rosePineJson
);
export const rosePineDawn: Theme = /* @__PURE__ */ Object.assign(
  { id: 'rose-pine-dawn' },
  rosePineDawnJson
);
export const rosePineMoon: Theme = /* @__PURE__ */ Object.assign(
  { id: 'rose-pine-moon' },
  rosePineMoonJson
);
export const slackDark: Theme = /* @__PURE__ */ Object.assign(
  { id: 'slack-dark' },
  slackDarkJson
);
export const slackOchin: Theme = /* @__PURE__ */ Object.assign(
  { id: 'slack-ochin' },
  slackOchinJson
);
export const snazzyLight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'snazzy-light' },
  snazzyLightJson
);
export const solarizedDark: Theme = /* @__PURE__ */ Object.assign(
  { id: 'solarized-dark' },
  solarizedDarkJson
);
export const solarizedLight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'solarized-light' },
  solarizedLightJson
);
export const synthwave84: Theme = /* @__PURE__ */ Object.assign(
  { id: 'synthwave-84' },
  synthwave84Json
);
export const tokyoNight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'tokyo-night' },
  tokyoNightJson
);
export const vesper: Theme = /* @__PURE__ */ Object.assign(
  { id: 'vesper' },
  vesperJson
);
export const vitesseBlack: Theme = /* @__PURE__ */ Object.assign(
  { id: 'vitesse-black' },
  vitesseBlackJson
);
export const vitesseDark: Theme = /* @__PURE__ */ Object.assign(
  { id: 'vitesse-dark' },
  vitesseDarkJson
);
export const vitesseLight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'vitesse-light' },
  vitesseLightJson
);
export const pierreDark: Theme = /* @__PURE__ */ Object.assign(
  { id: 'pierre-dark' },
  pierreDarkJson
);
export const pierreDarkProtanopiaDeuteranopia: Theme =
  /* @__PURE__ */ Object.assign(
    { id: 'pierre-dark-protanopia-deuteranopia' },
    pierreDarkProtanopiaDeuteranopiaJson
  );
export const pierreDarkSoft: Theme = /* @__PURE__ */ Object.assign(
  { id: 'pierre-dark-soft' },
  pierreDarkSoftJson
);
export const pierreDarkTritanopia: Theme = /* @__PURE__ */ Object.assign(
  { id: 'pierre-dark-tritanopia' },
  pierreDarkTritanopiaJson
);
export const pierreDarkVibrant: Theme = /* @__PURE__ */ Object.assign(
  { id: 'pierre-dark-vibrant' },
  pierreDarkVibrantJson
);
export const pierreLight: Theme = /* @__PURE__ */ Object.assign(
  { id: 'pierre-light' },
  pierreLightJson
);
export const pierreLightProtanopiaDeuteranopia: Theme =
  /* @__PURE__ */ Object.assign(
    { id: 'pierre-light-protanopia-deuteranopia' },
    pierreLightProtanopiaDeuteranopiaJson
  );
export const pierreLightSoft: Theme = /* @__PURE__ */ Object.assign(
  { id: 'pierre-light-soft' },
  pierreLightSoftJson
);
export const pierreLightTritanopia: Theme = /* @__PURE__ */ Object.assign(
  { id: 'pierre-light-tritanopia' },
  pierreLightTritanopiaJson
);
export const pierreLightVibrant: Theme = /* @__PURE__ */ Object.assign(
  { id: 'pierre-light-vibrant' },
  pierreLightVibrantJson
);

export const themes: readonly Theme[] = [
  andromeeda,
  auroraX,
  ayuDark,
  ayuLight,
  ayuMirage,
  catppuccinFrappe,
  catppuccinLatte,
  catppuccinMacchiato,
  catppuccinMocha,
  darkPlus,
  dracula,
  draculaSoft,
  everforestDark,
  everforestLight,
  githubDark,
  githubDarkDefault,
  githubDarkDimmed,
  githubDarkHighContrast,
  githubLight,
  githubLightDefault,
  githubLightHighContrast,
  gruvboxDarkHard,
  gruvboxDarkMedium,
  gruvboxDarkSoft,
  gruvboxLightHard,
  gruvboxLightMedium,
  gruvboxLightSoft,
  horizon,
  horizonBright,
  houston,
  kanagawaDragon,
  kanagawaLotus,
  kanagawaWave,
  laserwave,
  lightPlus,
  materialTheme,
  materialThemeDarker,
  materialThemeLighter,
  materialThemeOcean,
  materialThemePalenight,
  minDark,
  minLight,
  monokai,
  nightOwl,
  nightOwlLight,
  nord,
  oneDarkPro,
  oneLight,
  plastic,
  poimandres,
  red,
  rosePine,
  rosePineDawn,
  rosePineMoon,
  slackDark,
  slackOchin,
  snazzyLight,
  solarizedDark,
  solarizedLight,
  synthwave84,
  tokyoNight,
  vesper,
  vitesseBlack,
  vitesseDark,
  vitesseLight,
  pierreDark,
  pierreDarkProtanopiaDeuteranopia,
  pierreDarkSoft,
  pierreDarkTritanopia,
  pierreDarkVibrant,
  pierreLight,
  pierreLightProtanopiaDeuteranopia,
  pierreLightSoft,
  pierreLightTritanopia,
  pierreLightVibrant,
];
