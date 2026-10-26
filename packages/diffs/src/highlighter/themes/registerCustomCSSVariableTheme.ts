import { formatCSSVariablePrefix } from '../../utils/formatCSSVariablePrefix';
import { createCSSVariablesTheme } from './createCSSVariablesTheme';
import { registerCustomTheme } from './registerCustomTheme';

export function registerCustomCSSVariableTheme(
  name: string,
  variableDefaults: Record<string, string>,
  fontStyle: boolean = false
): void {
  const theme = createCSSVariablesTheme({
    name,
    variablePrefix: formatCSSVariablePrefix('global'),
    variableDefaults,
    fontStyle,
  });
  registerCustomTheme(name, () => Promise.resolve(theme), 'diffs');
}
