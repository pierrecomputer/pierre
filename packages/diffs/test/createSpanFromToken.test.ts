import { expect, test } from 'bun:test';

import { createSpanFromToken } from '../src/utils/createSpanNodeFromToken';
import { installDom } from './domHarness';

test('a carriage return token renders as an empty span', () => {
  const dom = installDom();
  try {
    expect(createSpanFromToken({ content: '\r', offset: 2 }).textContent).toBe(
      ''
    );
    expect(createSpanFromToken({ content: '\n', offset: 3 }).textContent).toBe(
      '\n'
    );
    expect(createSpanFromToken({ content: 'a', offset: 0 }).textContent).toBe(
      'a'
    );
  } finally {
    dom.cleanup();
  }
});
