import { palettes } from '../palettes';
import { light } from './light';
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

export const protanDeutanLight: Roles = {
  bg: light.bg,
  fg: light.fg,
  border: light.border,
  accent: {
    primary: blue['500'], // keep Pierre blue (brand). Intrinsically bright →
    link: blue['500'], // contrast is report-only in the gate, like base Pierre.
    subtle: blue['100'],
    contrastOnAccent: '#ffffff',
  },
  states: {
    success: blue['700'], // added/positive → blue pole (diff-add bg, git "A")
    danger: orange['700'], // deleted/error → orange pole (diff-del bg, git "D")
    warn: yellow['500'], // bright "caution" yellow; ΔE-separated from danger by big luminance gap
    info: cyan['700'], // cool side; pairs against merge in the conflict view
    merge: violet['800'], // blue-violet conflict color; deep stop widens the luminance split from info
  },
  syntax: {
    comment: neutral['600'], // neutral — luminance only
    string: blue['800'], // = diff "inserted" text → deep blue (≥8 ΔE from keyword)
    number: cyan['700'], // cool side
    keyword: violet['600'], // blue-violet
    regexp: cyan['700'],
    func: indigo['700'], // deep blue-violet
    type: purple['600'], // reads blue-violet under red-green CVD
    variable: orange['700'], // orange pole — workhorse identifier (deep stop clears 3:1 after simulation)
    operator: cyan['700'],
    punctuation: neutral['700'],
    constant: amber['700'], // orange side, deep
    parameter: neutral['700'],
    namespace: amber['700'],
    decorator: blue['700'],
    escape: teal['700'],
    invalid: neutral['1040'],
    tag: orange['700'], // = diff "deleted" text → orange pole
    attribute: amber['700'],
  },
  ansi: {
    black: neutral['980'],
    red: orange['700'], // terminal "error red" → orange so red≠green
    green: blue['700'], // terminal "success green" → blue
    yellow: yellow['500'],
    blue: blue['600'],
    magenta: violet['600'],
    cyan: cyan['700'],
    white: neutral['300'],
    brightBlack: neutral['980'],
    brightRed: orange['600'],
    brightGreen: blue['600'],
    brightYellow: yellow['500'],
    brightBlue: blue['500'],
    brightMagenta: violet['500'],
    brightCyan: cyan['600'],
    brightWhite: neutral['300'],
  },
};
