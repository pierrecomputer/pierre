import { describe, expect, test } from 'bun:test';

import { ThemedDiffsHubViewer as ReactThemedDiffsHubViewer } from '../../components/ThemedDiffsHubViewer';
import { ThemedFile as ReactThemedFile } from '../../components/ThemedFile';
import { ThemedFileDiff as ReactThemedFileDiff } from '../../components/ThemedFileDiff';

describe('themed diffs surfaces', () => {
  test('exports React diff surface components', () => {
    expect(ReactThemedDiffsHubViewer).toBeDefined();
    expect(typeof ReactThemedFile).toBe('function');
    expect(typeof ReactThemedFileDiff).toBe('function');
  });
});
