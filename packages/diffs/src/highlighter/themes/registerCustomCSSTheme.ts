import { createCssVariablesTheme } from 'shiki';
import { formatCSSVariablePrefix } from 'src/utils/formatCSSVariablePrefix';

import { registerCustomTheme } from './registerCustomTheme';

export function registerCustomCSSTheme(
  name: string,
  variableDefaults: Record<string, string>
): void {
  const theme = createCssVariablesTheme({
    name,
    variablePrefix: formatCSSVariablePrefix(),
    variableDefaults,
    // NOTE(amadeus): Not sure the impact of this
    fontStyle: true,
  });

  registerCustomTheme(name, () => Promise.resolve(theme));
}
