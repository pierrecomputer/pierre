export function formatCSSVariablePrefix(type: 'global' | 'token') {
  return `--${type === 'token' ? 'diffs-token' : 'diffs'}-`;
}
