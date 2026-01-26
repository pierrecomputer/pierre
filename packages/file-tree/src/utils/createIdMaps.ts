const hashId = (input: string): string => {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    const char = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

export const createIdMaps = (rootId: string) => {
  const idByKey = new Map<string, string>();
  const keyById = new Map<string, string>();
  const usedIds = new Set<string>([rootId]);

  const getIdForKey = (key: string): string => {
    if (key === rootId) {
      return rootId;
    }

    const existing = idByKey.get(key);
    if (existing != null) {
      return existing;
    }

    const base = hashId(key);
    let id = `n${base}`;
    let suffix = 0;
    while (usedIds.has(id)) {
      suffix += 1;
      id = `n${base}${suffix.toString(36)}`;
    }

    usedIds.add(id);
    idByKey.set(key, id);
    keyById.set(id, key);
    return id;
  };

  const getKeyForId = (id: string): string | undefined => {
    if (id === rootId) {
      return rootId;
    }
    return keyById.get(id);
  };

  idByKey.set(rootId, rootId);
  keyById.set(rootId, rootId);

  return { getIdForKey, getKeyForId };
};
