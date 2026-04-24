import type { CSSProperties } from 'react';

/**
 * Converts a React style object (e.g. from FileTree style prop) to a CSS string
 * for display in a File component below each tree example.
 */
export function styleObjectToCss(
  style: CSSProperties | Record<string, string | number | undefined>
): string {
  const lines = Object.entries(style)
    .filter(([, v]) => v != null && v !== '')
    .map(([key, value]) => {
      const prop = key.startsWith('--')
        ? key
        : key.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `  ${prop}: ${value};`;
    });
  return `file-tree-container {\n${lines.join('\n')}\n}`;
}
