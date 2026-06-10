export interface DefaultExport<T> {
  default: T;
}

// Unwraps the module-namespace shape produced by dynamic import() loaders while
// leaving bare theme objects untouched. ThemeLike values do not use a top-level
// `default` key, so this heuristic is safe for theming loaders.
export function unwrapDefault<T>(value: T | DefaultExport<T>): T {
  return value !== null && typeof value === 'object' && 'default' in value
    ? value.default
    : value;
}
