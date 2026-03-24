import { describe, expect, test } from 'bun:test';
import type { Element } from 'hast';

import { CUSTOM_HEADER_SLOT_ID } from '../src/constants';
import { createFileHeaderElement } from '../src/utils/createFileHeaderElement';

describe('createFileHeaderElement', () => {
  test('renders a single custom header slot in custom mode', () => {
    const header = createFileHeaderElement({
      fileOrDiff: {
        name: 'src/index.ts',
        contents: 'export {}\n',
      },
      themeStyles: '--test: 1;',
      themeType: 'light',
      mode: 'custom',
    });

    expect(header.tagName).toBe('div');
    expect(header.properties['data-diffs-header']).toBe('');
    expect(header.children).toHaveLength(1);

    const slot = header.children[0] as Element;
    expect(slot.tagName).toBe('slot');
    expect(slot.properties.name).toBe(CUSTOM_HEADER_SLOT_ID);
  });
});
