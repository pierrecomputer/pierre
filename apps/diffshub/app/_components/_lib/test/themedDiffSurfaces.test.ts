import { describe, expect, test } from 'bun:test';

import { ThemedDiffsHubViewer as ReactThemedDiffsHubViewer } from '../../ThemedDiffsHubViewer';
import { ThemedFile as ReactThemedFile } from '../../ThemedFile';
import { ThemedFileDiff as ReactThemedFileDiff } from '../../ThemedFileDiff';

describe('themed diffs surfaces', () => {
  test('exports React diff surface components', () => {
    expect(ReactThemedDiffsHubViewer).toBeDefined();
    expect(typeof ReactThemedFile).toBe('function');
    expect(typeof ReactThemedFileDiff).toBe('function');
  });
});
