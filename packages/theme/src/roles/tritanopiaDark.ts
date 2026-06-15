import { palettes } from '../palettes';
import { dark } from './dark';
import type { Roles } from './Roles';
const { neutral, vermillion, amber, teal, blue, purple, magenta } = palettes;

export const tritanopiaDark: Roles = {
  bg: dark.bg,
  fg: dark.fg,
  border: dark.border,
  accent: {
    primary: blue['500'],
    link: blue['500'],
    subtle: blue['950'],
    contrastOnAccent: neutral['1040'],
  },
  states: {
    success: teal['300'], // added → teal
    danger: vermillion['400'], // deleted/error → red
    warn: amber['400'], // caution
    info: blue['400'], // cyan side
    merge: magenta['400'], // reddish-purple
  },
  syntax: {
    comment: neutral['600'],
    string: teal['300'], // = diff inserted → teal
    number: blue['400'],
    keyword: purple['400'], // reddish-purple (≥8 ΔE from red variable)
    regexp: teal['400'],
    func: blue['300'],
    type: magenta['400'],
    variable: vermillion['400'], // red pole
    operator: teal['500'],
    punctuation: neutral['700'],
    constant: amber['300'],
    parameter: neutral['400'],
    namespace: vermillion['400'],
    decorator: blue['400'],
    escape: teal['400'],
    invalid: neutral['020'],
    tag: vermillion['400'], // = diff deleted → red
    attribute: teal['400'],
  },
  ansi: {
    black: neutral['1000'],
    red: vermillion['400'],
    green: teal['400'],
    yellow: amber['400'],
    blue: blue['400'],
    magenta: magenta['400'],
    cyan: teal['300'],
    white: neutral['300'],
    brightBlack: neutral['1000'],
    brightRed: vermillion['300'],
    brightGreen: teal['300'],
    brightYellow: amber['300'],
    brightBlue: blue['300'],
    brightMagenta: magenta['300'],
    brightCyan: teal['300'],
    brightWhite: neutral['300'],
  },
};
