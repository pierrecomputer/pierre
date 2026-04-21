import { describe, expect, test } from 'bun:test';

import {
  FILE_TREE_DENSITY_PRESETS,
  resolveFileTreeDensity,
} from '../src/model/density';
import { FILE_TREE_DEFAULT_ITEM_HEIGHT } from '../src/model/virtualization';

describe('resolveFileTreeDensity', () => {
  test('returns the default preset when density is undefined', () => {
    expect(resolveFileTreeDensity(undefined, undefined)).toEqual({
      itemHeight: FILE_TREE_DENSITY_PRESETS.default.itemHeight,
      factor: FILE_TREE_DENSITY_PRESETS.default.factor,
    });
  });

  test('resolves keyword presets', () => {
    expect(resolveFileTreeDensity('compact', undefined)).toEqual({
      itemHeight: FILE_TREE_DENSITY_PRESETS.compact.itemHeight,
      factor: FILE_TREE_DENSITY_PRESETS.compact.factor,
    });
    expect(resolveFileTreeDensity('relaxed', undefined)).toEqual({
      itemHeight: FILE_TREE_DENSITY_PRESETS.relaxed.itemHeight,
      factor: FILE_TREE_DENSITY_PRESETS.relaxed.factor,
    });
  });

  test('explicit itemHeight overrides the preset row height but not the factor', () => {
    expect(resolveFileTreeDensity('compact', 28)).toEqual({
      itemHeight: 28,
      factor: FILE_TREE_DENSITY_PRESETS.compact.factor,
    });
  });

  test('numeric density keeps the default row height by default', () => {
    expect(resolveFileTreeDensity(0.85, undefined)).toEqual({
      itemHeight: FILE_TREE_DENSITY_PRESETS.default.itemHeight,
      factor: 0.85,
    });
  });

  test('numeric density still honors an explicit itemHeight', () => {
    expect(resolveFileTreeDensity(1.5, 40)).toEqual({
      itemHeight: 40,
      factor: 1.5,
    });
  });

  test('FILE_TREE_DEFAULT_ITEM_HEIGHT is sourced from the default preset', () => {
    expect(FILE_TREE_DEFAULT_ITEM_HEIGHT).toBe(
      FILE_TREE_DENSITY_PRESETS.default.itemHeight
    );
  });
});
