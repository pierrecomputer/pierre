import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import { assertDefined } from './testUtils';

// NOTE(amadeus): This was a known tricky patch that our renderer would break
// on at one point
const patchFixture = readFileSync(resolve(__dirname, './file.patch'), 'utf-8');

describe('file.patch fixture', () => {
  test('parses and renders the patch file', async () => {
    const parsed = parsePatchFiles(patchFixture, 'file-patch');
    expect(parsed.length).toBe(1);
    expect(parsed).toMatchSnapshot('parsed patch');
    const file = parsed.at(0)?.files[0];
    assertDefined(file, 'file should be defined');
    const renderer = new DiffHunksRenderer({ diffStyle: 'split' });
    const result = await renderer.asyncRender(file);
    expect(result).toMatchSnapshot('rendered patch');
  });
});
