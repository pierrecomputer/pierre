import { describe, expect, test } from 'bun:test';

import { ThemedCodeView as ReactThemedCodeView } from '../react/ThemedCodeView';
import { ThemedFile as ReactThemedFile } from '../react/ThemedFile';
import { ThemedFileDiff as ReactThemedFileDiff } from '../react/ThemedFileDiff';

describe('themed diffs surfaces', () => {
  test('exports React diff surface components', () => {
    expect(ReactThemedCodeView).toBeDefined();
    expect(typeof ReactThemedFile).toBe('function');
    expect(typeof ReactThemedFileDiff).toBe('function');
  });
});
