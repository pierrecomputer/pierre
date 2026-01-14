import { createCssVariablesTheme } from 'shiki';
import { formatCSSVariablePrefix } from 'src/utils/formatCSSVariablePrefix';

import { registerCustomTheme } from './registerCustomTheme';

export function registerCustomCSSVariableTheme(
  name: string,
  variableDefaults: Record<string, string>,
  fontStyle: boolean = false
): void {
  const theme = createCssVariablesTheme({
    name,
    variablePrefix: formatCSSVariablePrefix(),
    variableDefaults,
    fontStyle,
  });

  registerCustomTheme(name, () => Promise.resolve(theme));
}
