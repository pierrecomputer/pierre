/**
 * The maker of new split and stack IDs of one store: `<kind>-<prefix>-<count>`,
 * with 8 random base-36 characters of prefix, made at the first new ID. The
 * features that make nodes (`edits`, `stacks`) give it to their store.
 */
export function randomIds(): (kind: 'split' | 'stack') => string {
  let prefix: string | null = null;
  let count = 0;
  return (kind) => {
    prefix ??= Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
      (byte % 36).toString(36)
    ).join('');
    return `${kind}-${prefix}-${++count}`;
  };
}
