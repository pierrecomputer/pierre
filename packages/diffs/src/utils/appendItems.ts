// Appends every entry of `items` onto `target` one at a time. Deliberately not
// `target.push(...items)`: a spread passes one argument per entry and engines
// cap argument counts (V8 near 124k, JavaScriptCore near 639k), so spreading a
// line-sized array such as the rows of a massive hunk throws a RangeError.
export function appendItems<T>(target: T[], items: readonly T[]): void {
  for (const item of items) {
    target.push(item);
  }
}
