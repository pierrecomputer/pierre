import { hashId } from './hashId';

export type IdMaps = {
  getIdForKey: (key: string) => string;
  getKeyForId: (id: string) => string | undefined;
};

export const createIdMaps = (rootId: string): IdMaps => {
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
