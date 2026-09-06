import type { Theme } from '../lib/index';
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
import pierreDarkProtanopiaJson from './pierre-dark-protanopia.json' with { type: 'json' };
import pierreDarkSoftJson from './pierre-dark-soft.json' with { type: 'json' };
import pierreDarkTritanopiaJson from './pierre-dark-tritanopia.json' with { type: 'json' };
import pierreDarkJson from './pierre-dark.json' with { type: 'json' };
import pierreLightProtanopiaJson from './pierre-light-protanopia.json' with { type: 'json' };
import pierreLightSoftJson from './pierre-light-soft.json' with { type: 'json' };
import pierreLightTritanopiaJson from './pierre-light-tritanopia.json' with { type: 'json' };
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

/** A pass-through theme: every color resolves to its `var(--hls-*)` variable. */
export const cssVariables: Theme = {
  name: 'CSS Variables',
  appearance: 'dark',
  cssVariables: true,
  style: {},
};

/** Convert a Zed theme to CSS custom properties. */
export function toCSS({ style }: Theme): string {
  let css = '';
  if (style == null) return css;
  const background = style['editor.background'] ?? style.background;
  const foreground =
    style['editor.foreground'] ?? style.text ?? style.foreground;
  if (background) {
    css += `--hls-background: ${background};`;
  }
  if (foreground) {
    css += `--hls-foreground: ${foreground};`;
  }
  if (style.syntax != null) {
    for (const [name, value] of Object.entries(style.syntax)) {
      const color = typeof value === 'string' ? value : value.color;
      if (color) {
        css += `--hls-${name.replace(/[._]/g, '-')}: ${color};`;
      }
    }
  }
  return css;
}

export const andromeeda: Theme = andromeedaJson;
export const auroraX: Theme = auroraXJson;
export const ayuDark: Theme = ayuDarkJson;
export const ayuLight: Theme = ayuLightJson;
export const ayuMirage: Theme = ayuMirageJson;
export const catppuccinFrappe: Theme = catppuccinFrappeJson;
export const catppuccinLatte: Theme = catppuccinLatteJson;
export const catppuccinMacchiato: Theme = catppuccinMacchiatoJson;
export const catppuccinMocha: Theme = catppuccinMochaJson;
export const darkPlus: Theme = darkPlusJson;
export const dracula: Theme = draculaJson;
export const draculaSoft: Theme = draculaSoftJson;
export const everforestDark: Theme = everforestDarkJson;
export const everforestLight: Theme = everforestLightJson;
export const githubDark: Theme = githubDarkJson;
export const githubDarkDefault: Theme = githubDarkDefaultJson;
export const githubDarkDimmed: Theme = githubDarkDimmedJson;
export const githubDarkHighContrast: Theme = githubDarkHighContrastJson;
export const githubLight: Theme = githubLightJson;
export const githubLightDefault: Theme = githubLightDefaultJson;
export const githubLightHighContrast: Theme = githubLightHighContrastJson;
export const gruvboxDarkHard: Theme = gruvboxDarkHardJson;
export const gruvboxDarkMedium: Theme = gruvboxDarkMediumJson;
export const gruvboxDarkSoft: Theme = gruvboxDarkSoftJson;
export const gruvboxLightHard: Theme = gruvboxLightHardJson;
export const gruvboxLightMedium: Theme = gruvboxLightMediumJson;
export const gruvboxLightSoft: Theme = gruvboxLightSoftJson;
export const horizon: Theme = horizonJson;
export const horizonBright: Theme = horizonBrightJson;
export const houston: Theme = houstonJson;
export const kanagawaDragon: Theme = kanagawaDragonJson;
export const kanagawaLotus: Theme = kanagawaLotusJson;
export const kanagawaWave: Theme = kanagawaWaveJson;
export const laserwave: Theme = laserwaveJson;
export const lightPlus: Theme = lightPlusJson;
export const materialTheme: Theme = materialThemeJson;
export const materialThemeDarker: Theme = materialThemeDarkerJson;
export const materialThemeLighter: Theme = materialThemeLighterJson;
export const materialThemeOcean: Theme = materialThemeOceanJson;
export const materialThemePalenight: Theme = materialThemePalenightJson;
export const minDark: Theme = minDarkJson;
export const minLight: Theme = minLightJson;
export const monokai: Theme = monokaiJson;
export const nightOwl: Theme = nightOwlJson;
export const nightOwlLight: Theme = nightOwlLightJson;
export const nord: Theme = nordJson;
export const oneDarkPro: Theme = oneDarkProJson;
export const oneLight: Theme = oneLightJson;
export const plastic: Theme = plasticJson;
export const poimandres: Theme = poimandresJson;
export const red: Theme = redJson;
export const rosePine: Theme = rosePineJson;
export const rosePineDawn: Theme = rosePineDawnJson;
export const rosePineMoon: Theme = rosePineMoonJson;
export const slackDark: Theme = slackDarkJson;
export const slackOchin: Theme = slackOchinJson;
export const snazzyLight: Theme = snazzyLightJson;
export const solarizedDark: Theme = solarizedDarkJson;
export const solarizedLight: Theme = solarizedLightJson;
export const synthwave84: Theme = synthwave84Json;
export const tokyoNight: Theme = tokyoNightJson;
export const vesper: Theme = vesperJson;
export const vitesseBlack: Theme = vitesseBlackJson;
export const vitesseDark: Theme = vitesseDarkJson;
export const vitesseLight: Theme = vitesseLightJson;
export const pierreDark: Theme = pierreDarkJson;
export const pierreDarkProtanopia: Theme = pierreDarkProtanopiaJson;
export const pierreDarkSoft: Theme = pierreDarkSoftJson;
export const pierreDarkTritanopia: Theme = pierreDarkTritanopiaJson;
export const pierreLight: Theme = pierreLightJson;
export const pierreLightProtanopia: Theme = pierreLightProtanopiaJson;
export const pierreLightSoft: Theme = pierreLightSoftJson;
export const pierreLightTritanopia: Theme = pierreLightTritanopiaJson;

export const themes: Record<string, () => Promise<{ default: Theme }>> = {};
