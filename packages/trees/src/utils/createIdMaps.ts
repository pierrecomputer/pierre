import { hashId } from './hashId';

export type IdMaps = {
  getIdForKey: (key: string) => string;
  getKeyForId: (id: string) => string | undefined;
};

interface CreateIdMapsOptions {
  includeReverseMap?: boolean;
}

export const createIdMaps = (
  rootId: string,
  options: CreateIdMapsOptions = {}
): IdMaps => {
  const includeReverseMap = options.includeReverseMap ?? true;
  const idByKey = new Map<string, string>();
  const keyById = includeReverseMap ? new Map<string, string>() : undefined;
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
    if (keyById != null) {
      keyById.set(id, key);
    }
    return id;
  };

  const getKeyForId = (id: string): string | undefined => {
    if (id === rootId) {
      return rootId;
    }
    return keyById?.get(id);
  };

  idByKey.set(rootId, rootId);
  if (keyById != null) {
    keyById.set(rootId, rootId);
  }

  return { getIdForKey, getKeyForId };
};
