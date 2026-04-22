import { describe, expect, test } from 'bun:test';

import {
  FILE_TREE_DENSITY_PRESETS,
  resolveFileTreeDensity,
} from '../src/model/density';
import { FILE_TREE_DEFAULT_ITEM_HEIGHT } from '../src/model/virtualization';
import { preloadFileTree } from '../src/render/FileTree';
import { serializeFileTreeSsrPayload } from '../src/ssr';

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

describe('preloadFileTree density host style', () => {
  test('keyword density is inlined on the SSR host element', () => {
    const payload = preloadFileTree({
      density: 'compact',
      paths: ['README.md'],
    });

    const compact = FILE_TREE_DENSITY_PRESETS.compact;
    const expectedStyle = `style="--trees-item-height:${String(compact.itemHeight)}px;--trees-density-override:${String(compact.factor)}"`;

    expect(payload.outerStart).toContain(expectedStyle);
    expect(payload.domOuterStart).toContain(expectedStyle);

    const declarativeHtml = serializeFileTreeSsrPayload(payload);
    const domHtml = serializeFileTreeSsrPayload(payload, 'dom');
    expect(declarativeHtml).toContain(expectedStyle);
    expect(domHtml).toContain(expectedStyle);
  });

  test('numeric density keeps the default row height and inlines the factor', () => {
    const payload = preloadFileTree({
      density: 0.75,
      paths: ['README.md'],
    });

    const expectedStyle = `style="--trees-item-height:${String(FILE_TREE_DENSITY_PRESETS.default.itemHeight)}px;--trees-density-override:0.75"`;

    expect(payload.outerStart).toContain(expectedStyle);
    expect(payload.domOuterStart).toContain(expectedStyle);
  });

  test('explicit itemHeight overrides the preset row height in the host style', () => {
    const payload = preloadFileTree({
      density: 'relaxed',
      itemHeight: 44,
      paths: ['README.md'],
    });

    const relaxed = FILE_TREE_DENSITY_PRESETS.relaxed;
    expect(payload.outerStart).toContain(
      `style="--trees-item-height:44px;--trees-density-override:${String(relaxed.factor)}"`
    );
  });
});
