import type { FileTreeOptions } from '@pierre/trees';

export type FileTreePathOptions = FileTreeOptions & {
  paths: readonly string[];
};
