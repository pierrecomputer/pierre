export type FileTreeDensityKeyword = 'compact' | 'default' | 'relaxed';

export type FileTreeDensity = FileTreeDensityKeyword | number;

export interface FileTreeDensityPreset {
  itemHeight: number;
  factor: number;
}

export const FILE_TREE_DENSITY_PRESETS: Record<
  FileTreeDensityKeyword,
  FileTreeDensityPreset
> = {
  compact: { itemHeight: 24, factor: 0.8 },
  default: { itemHeight: 30, factor: 1 },
  relaxed: { itemHeight: 36, factor: 1.2 },
};

// Collapses the public density option (keyword preset or numeric factor) plus
// an optional explicit itemHeight into the concrete row height + spacing
// factor used by the model and the React wrapper. An explicit itemHeight
// always wins for the row size; numeric density keeps the default row height.
export function resolveFileTreeDensity(
  density: FileTreeDensity | undefined,
  explicitItemHeight: number | undefined
): FileTreeDensityPreset {
  if (typeof density === 'number') {
    return {
      itemHeight:
        explicitItemHeight ?? FILE_TREE_DENSITY_PRESETS.default.itemHeight,
      factor: density,
    };
  }

  const preset = FILE_TREE_DENSITY_PRESETS[density ?? 'default'];
  return {
    itemHeight: explicitItemHeight ?? preset.itemHeight,
    factor: preset.factor,
  };
}
