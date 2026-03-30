// Uses a lightweight FNV-1a variant because this path runs for every tree key.
// Collisions are still handled by createIdMaps via deterministic suffixing.
export const hashId = (input: string): string => {
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
};
