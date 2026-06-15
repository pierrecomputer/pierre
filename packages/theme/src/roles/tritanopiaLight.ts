import { palettes } from '../palettes';
import { light } from './light';
import type { Roles } from './Roles';
const { neutral, vermillion, amber, teal, blue, purple, magenta } = palettes;

export const tritanopiaLight: Roles = {
  bg: light.bg,
  fg: light.fg,
  border: light.border,
  accent: {
    primary: blue['500'], // keep Pierre blue (reads cyan-blue, clearly ≠ red)
    link: blue['500'],
    subtle: blue['100'],
    contrastOnAccent: '#ffffff',
  },
  states: {
    success: teal['700'], // added/positive → teal (cyan pole)
    danger: vermillion['600'], // deleted/error → red (red pole preserved under tritanopia)
    warn: amber['500'], // caution; brighter stop widens the luminance gap from danger vermillion (report-only contrast)
    info: blue['600'], // cyan side
    merge: magenta['700'], // reddish-purple — tritan-safe, far from blue/teal AND from vermillion
  },
  syntax: {
    comment: neutral['600'],
    string: teal['700'], // = diff inserted → teal (cyan pole)
    number: blue['600'], // cyan side
    keyword: purple['600'], // reddish-purple (≥8 ΔE from red variable)
    regexp: teal['700'],
    func: blue['700'], // deep blue
    type: magenta['600'], // reddish-purple
    variable: vermillion['700'], // red pole — workhorse identifier
    operator: teal['700'],
    punctuation: neutral['700'],
    constant: amber['700'],
    parameter: neutral['700'],
    namespace: vermillion['600'],
    decorator: blue['600'],
    escape: teal['700'],
    invalid: neutral['1040'],
    tag: vermillion['600'], // = diff deleted → red pole
    attribute: teal['700'],
  },
  ansi: {
    black: neutral['980'],
    red: vermillion['600'], // red preserved
    green: teal['700'], // success green → teal so red≠green
    yellow: amber['600'],
    blue: blue['600'],
    magenta: magenta['700'],
    cyan: teal['600'],
    white: neutral['300'],
    brightBlack: neutral['980'],
    brightRed: vermillion['500'],
    brightGreen: teal['600'],
    brightYellow: amber['500'],
    brightBlue: blue['500'],
    brightMagenta: magenta['600'],
    brightCyan: teal['500'],
    brightWhite: neutral['300'],
  },
};
