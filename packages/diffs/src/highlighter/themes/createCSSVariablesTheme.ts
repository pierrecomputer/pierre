import type { ThemeStyle } from '@pierre/highlights';

import type { CSSVariablesThemeOptions, DiffsTheme } from './types';

/** A CSS palette shared by TextMate scopes and Highlights syntax categories. */
export function createCSSVariablesTheme({
  name = 'css-variables',
  variablePrefix = '--diffs-',
  variableDefaults = {},
  fontStyle = true,
}: CSSVariablesThemeOptions = {}): DiffsTheme {
  const variable = (key: string): string => {
    const fallback = variableDefaults[key];
    return `var(${variablePrefix}${key}${fallback !== undefined && fallback !== '' ? `, ${fallback}` : ''})`;
  };
  const fg = variable('foreground');
  const bg = variable('background');
  const colors: Record<string, string> = {
    'editor.foreground': fg,
    'editor.background': bg,
  };
  for (const color of [
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
  ]) {
    const title = color[0].toUpperCase() + color.slice(1);
    colors[`terminal.ansi${title}`] = variable(`ansi-${color}`);
    colors[`terminal.ansiBright${title}`] = variable(`ansi-bright-${color}`);
  }
  const syntax: NonNullable<ThemeStyle['syntax']> = {
    comment: 'token-comment',
    string: 'token-string-expression',
    'string.escape': 'token-constant',
    'text.literal': 'token-string',
    keyword: 'token-keyword',
    operator: 'token-keyword',
    preproc: 'token-keyword',
    boolean: 'token-constant',
    number: 'token-constant',
    constant: 'token-constant',
    property: 'token-constant',
    'property.json_key': 'token-keyword',
    'variable.special': 'token-constant',
    'variable.parameter': 'token-parameter',
    function: 'token-function',
    constructor: 'token-function',
    type: 'token-function',
    attribute: 'token-function',
    tag: 'token-string-expression',
    punctuation: 'token-punctuation',
    link_text: 'token-link',
    link_uri: 'token-link',
    'diff.plus': 'token-inserted',
    'diff.minus': 'token-deleted',
  };
  if (fontStyle) {
    syntax.emphasis = { font_style: 'italic' };
    syntax['emphasis.strong'] = { font_weight: 700 };
    syntax.title = { font_weight: 700 };
  }
  return {
    name,
    type: 'dark',
    fg,
    bg,
    colors,
    cssVariables: { name, variablePrefix, variableDefaults, fontStyle },
    zed: {
      name,
      appearance: 'dark',
      cssVariables: { prefix: variablePrefix, defaults: variableDefaults },
      style: {
        'editor.foreground': 'foreground',
        'editor.background': 'background',
        syntax,
      },
    },
  };
}
