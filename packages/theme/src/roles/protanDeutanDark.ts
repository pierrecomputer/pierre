import { palettes } from '../palettes';
import { dark } from './dark';
import type { Roles } from './Roles';
const {
  neutral,
  orange,
  amber,
  yellow,
  teal,
  cyan,
  blue,
  indigo,
  violet,
  purple,
} = palettes;

export const protanDeutanDark: Roles = {
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
    success: blue['300'], // added → light blue (luminance-split from accent blue 500)
    danger: orange['500'], // deleted/error → orange (deeper stop widens the luminance gap from warn yellow)
    warn: yellow['300'], // bright caution yellow
    info: cyan['400'], // cool side
    merge: violet['400'], // blue-violet
  },
  syntax: {
    comment: neutral['600'],
    string: blue['300'], // = diff inserted → blue
    number: cyan['300'],
    keyword: violet['400'],
    regexp: cyan['400'],
    func: indigo['300'],
    type: purple['300'],
    variable: orange['400'], // orange pole
    operator: cyan['500'],
    punctuation: neutral['700'],
    constant: amber['300'],
    parameter: neutral['400'],
    namespace: amber['400'],
    decorator: blue['400'],
    escape: teal['400'],
    invalid: neutral['020'],
    tag: orange['400'], // = diff deleted → orange
    attribute: amber['400'],
  },
  ansi: {
    black: neutral['1000'],
    red: orange['400'],
    green: blue['400'],
    yellow: yellow['400'],
    blue: blue['500'],
    magenta: violet['400'],
    cyan: cyan['400'],
    white: neutral['300'],
    brightBlack: neutral['1000'],
    brightRed: orange['300'],
    brightGreen: blue['300'],
    brightYellow: yellow['300'],
    brightBlue: blue['400'],
    brightMagenta: violet['300'],
    brightCyan: cyan['300'],
    brightWhite: neutral['300'],
  },
};
