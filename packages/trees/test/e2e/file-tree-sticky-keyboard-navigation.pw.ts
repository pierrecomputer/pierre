import { expect, type Page, test } from '@playwright/test';

type StickyKeyboardRowSnapshot = {
  bottomWithinScroll: number;
  isFocused: boolean;
  isParked: boolean;
  isSticky: boolean;
  path: string;
  topWithinScroll: number;
};

type StickyKeyboardSample = {
  activeElementPath: string | null;
  activeElementIsParked: boolean;
  activeElementIsSticky: boolean;
  contextMenuPath: string | null;
  focusedPath: string | null;
  focusedRows: StickyKeyboardRowSnapshot[];
  mountedFlowPaths: string[];
  rows: StickyKeyboardRowSnapshot[];
  scrollTop: number;
  stickyOverlayBottomWithinScroll: number;
  stickyPaths: string[];
};

declare global {
  interface Window {
    __stickyKeyboardNavigationFixtureReady?: boolean;
    __stickyKeyboardNavigationProbe?: {
      focusStickyDomOnly: (path: string) => Promise<void>;
      focusStickyPath: (path: string) => Promise<void>;
      nextFrames: (count?: number) => Promise<void>;
      sample: () => StickyKeyboardSample;
      setScrollTop: (scrollTop: number) => void;
    };
  }
}

const fixturePath =
  '/test/e2e/fixtures/file-tree-sticky-keyboard-navigation.html';
const linuxArcScrollTop = 9_000;
const linuxArcStickyPaths = [
  'arch/',
  'arch/arc/',
  'arch/arc/boot/',
  'arch/arc/boot/dts/',
] as const;
const linuxArcIncludeScrollTop = 10_080;
const linuxArcIncludeStickyPaths = [
  'arch/',
  'arch/arc/',
  'arch/arc/include/',
  'arch/arc/include/asm/',
] as const;
const syntheticBranchScrollTop = 4_210;
const syntheticBranchStickyPaths = [
  'a1/',
  'a1/b2/',
  'a1/b2/c1/',
  'a1/b2/c1/d2/',
] as const;

const gotoFixture = async (page: Page, query: string = ''): Promise<void> => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => {
    browserErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });

  await page.goto(`${fixturePath}${query}`);
  try {
    await page.waitForFunction(
      () => window.__stickyKeyboardNavigationFixtureReady === true,
      undefined,
      { timeout: 5_000 }
    );
  } catch (error) {
    throw new Error(
      `Sticky keyboard fixture did not become ready. Browser errors: ${browserErrors.join(
        '\n'
      )}`,
      { cause: error }
    );
  }
};

const nextFrames = async (page: Page, count: number = 2): Promise<void> => {
  await page.evaluate((nextCount) => {
    return window.__stickyKeyboardNavigationProbe?.nextFrames(nextCount);
  }, count);
};

const setScrollTop = async (page: Page, scrollTop: number): Promise<void> => {
  await page.evaluate((nextScrollTop) => {
    window.__stickyKeyboardNavigationProbe?.setScrollTop(nextScrollTop);
  }, scrollTop);
  await nextFrames(page);
};

const focusStickyPath = async (page: Page, path: string): Promise<void> => {
  await page.evaluate((nextPath) => {
    return window.__stickyKeyboardNavigationProbe?.focusStickyPath(nextPath);
  }, path);
  await nextFrames(page);
};

const focusStickyDomOnly = async (page: Page, path: string): Promise<void> => {
  await page.evaluate((nextPath) => {
    return window.__stickyKeyboardNavigationProbe?.focusStickyDomOnly(nextPath);
  }, path);
  await nextFrames(page);
};

const sample = async (page: Page): Promise<StickyKeyboardSample> => {
  const result = await page.evaluate(() => {
    return window.__stickyKeyboardNavigationProbe?.sample() ?? null;
  });
  expect(result).not.toBeNull();
  if (result == null) {
    throw new Error('Missing sticky keyboard navigation sample.');
  }
  return result;
};

const prepareLinuxArcStickyStack = async (
  page: Page,
  focusedPath: string
): Promise<StickyKeyboardSample> => {
  await gotoFixture(page);
  await setScrollTop(page, linuxArcScrollTop);
  await focusStickyPath(page, focusedPath);
  const baseline = await sample(page);
  expect(baseline.scrollTop).toBe(linuxArcScrollTop);
  expect(baseline.stickyPaths).toEqual([...linuxArcStickyPaths]);
  expect(baseline.focusedPath).toBe(focusedPath);
  expect(baseline.activeElementPath).toBe(focusedPath);
  expect(baseline.activeElementIsSticky).toBe(true);
  return baseline;
};

const prepareLinuxArcIncludeStickyStack = async (
  page: Page,
  focusedPath: string
): Promise<StickyKeyboardSample> => {
  await gotoFixture(page);
  await setScrollTop(page, linuxArcIncludeScrollTop);
  await focusStickyPath(page, focusedPath);
  const baseline = await sample(page);
  expect(baseline.scrollTop).toBe(linuxArcIncludeScrollTop);
  expect(baseline.stickyPaths).toEqual([...linuxArcIncludeStickyPaths]);
  expect(baseline.focusedPath).toBe(focusedPath);
  expect(baseline.activeElementPath).toBe(focusedPath);
  return baseline;
};

const prepareSyntheticBranchStickyStack = async (
  page: Page,
  focusedPath: string,
  query: string = '?scenario=synthetic-branch'
): Promise<StickyKeyboardSample> => {
  await gotoFixture(page, query);
  await setScrollTop(page, syntheticBranchScrollTop);
  await focusStickyPath(page, focusedPath);
  const baseline = await sample(page);
  expect(baseline.scrollTop).toBe(syntheticBranchScrollTop);
  expect(baseline.stickyPaths).toEqual([...syntheticBranchStickyPaths]);
  expect(baseline.focusedPath).toBe(focusedPath);
  expect(baseline.activeElementPath).toBe(focusedPath);
  expect(baseline.activeElementIsSticky).toBe(true);
  expect(baseline.mountedFlowPaths[0]).toBe('a1/b2/c1/d2/file_5');
  return baseline;
};

const expectSyntheticBranchStickyStackPreserved = (
  after: StickyKeyboardSample,
  baseline: StickyKeyboardSample,
  focusedPath: string
): void => {
  expect(after.focusedPath).toBe(focusedPath);
  expect(after.activeElementPath).toBe(focusedPath);
  expect(after.stickyPaths).toEqual([...syntheticBranchStickyPaths]);
  expect(after.stickyPaths[1]).toBe('a1/b2/');
  expect(after.scrollTop).toBe(baseline.scrollTop);
  expect(after.mountedFlowPaths).toEqual(baseline.mountedFlowPaths);
  expect(after.mountedFlowPaths[0]).toBe('a1/b2/c1/d2/file_5');
  expect(after.mountedFlowPaths).not.toContain('a1/b1/');
  expect(after.mountedFlowPaths).not.toContain('a1/b1/c2/d2/file_16');
};

const getFocusedKeyboardProxyTop = (snapshot: StickyKeyboardSample): number => {
  const proxyRow =
    snapshot.focusedRows.find((row) => row.isParked) ??
    snapshot.focusedRows.find((row) => row.isSticky) ??
    null;
  expect(proxyRow).not.toBeNull();
  if (proxyRow == null) {
    throw new Error('Missing focused sticky keyboard proxy row.');
  }

  return proxyRow.topWithinScroll;
};

const getStickyRow = (
  snapshot: StickyKeyboardSample,
  path: string
): StickyKeyboardRowSnapshot | null =>
  snapshot.rows.find((row) => row.path === path && row.isSticky) ?? null;

const getMountedFlowRow = (
  snapshot: StickyKeyboardSample,
  path: string
): StickyKeyboardRowSnapshot | null =>
  snapshot.rows.find(
    (row) => row.path === path && !row.isSticky && !row.isParked
  ) ?? null;

test.describe('sticky keyboard navigation fixture', () => {
  test('ArrowDown from a non-first sticky folder focuses the next sticky folder without shifting the list', async ({
    page,
  }) => {
    const baseline = await prepareLinuxArcStickyStack(page, 'arch/arc/');

    await page.keyboard.press('ArrowDown');
    await nextFrames(page);

    const after = await sample(page);
    expect(after.focusedPath).toBe('arch/arc/boot/');
    expect(after.activeElementPath).toBe('arch/arc/boot/');
    expect(after.scrollTop).toBe(baseline.scrollTop);
    expect(after.stickyPaths).toEqual(baseline.stickyPaths);
    expect(after.mountedFlowPaths).toEqual(baseline.mountedFlowPaths);
    expect(after.focusedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isFocused: true,
          isSticky: true,
          path: 'arch/arc/boot/',
        }),
      ])
    );
  });

  test('ArrowDown from a focused sticky DOM mirror syncs focus before moving in the linux workload', async ({
    page,
  }) => {
    await gotoFixture(page);
    await setScrollTop(page, linuxArcScrollTop);
    await focusStickyDomOnly(page, 'arch/arc/');

    const baseline = await sample(page);
    expect(baseline.scrollTop).toBe(linuxArcScrollTop);
    expect(baseline.stickyPaths).toEqual([...linuxArcStickyPaths]);
    expect(baseline.activeElementPath).toBe('arch/arc/');
    expect(baseline.activeElementIsSticky).toBe(true);

    await page.keyboard.press('ArrowDown');
    await nextFrames(page);

    const after = await sample(page);
    expect(after.focusedPath).toBe('arch/arc/boot/');
    expect(after.activeElementPath).toBe('arch/arc/boot/');
    expect(after.scrollTop).toBe(baseline.scrollTop);
    expect(after.stickyPaths).toEqual(baseline.stickyPaths);
    expect(after.mountedFlowPaths).toEqual(baseline.mountedFlowPaths);
  });

  test('Shift+F10 from a focused sticky DOM mirror opens the menu for that sticky path', async ({
    page,
  }) => {
    await gotoFixture(page, '?scenario=synthetic-branch');
    await setScrollTop(page, syntheticBranchScrollTop);
    await focusStickyDomOnly(page, 'a1/b2/');

    const baseline = await sample(page);
    expect(baseline.contextMenuPath).toBeNull();
    expect(baseline.scrollTop).toBe(syntheticBranchScrollTop);
    expect(baseline.activeElementPath).toBe('a1/b2/');
    expect(baseline.activeElementIsSticky).toBe(true);

    await page.keyboard.down('Shift');
    await page.keyboard.press('F10');
    await page.keyboard.up('Shift');
    await nextFrames(page);

    const after = await sample(page);
    expect(after.contextMenuPath).toBe('a1/b2/');
    expect(after.focusedPath).toBe('a1/b2/');
    expect(after.scrollTop).toBe(baseline.scrollTop);
  });

  test('ArrowDown from a first sticky folder at its depth keeps the sticky stack stable', async ({
    page,
  }) => {
    const baseline = await prepareLinuxArcStickyStack(page, 'arch/arc/boot/');

    await page.keyboard.press('ArrowDown');
    await nextFrames(page);

    const after = await sample(page);
    expect(after.focusedPath).toBe('arch/arc/boot/dts/');
    expect(after.activeElementPath).toBe('arch/arc/boot/dts/');
    expect(after.scrollTop).toBe(baseline.scrollTop);
    expect(after.stickyPaths).toEqual(baseline.stickyPaths);
    expect(after.mountedFlowPaths).toEqual(baseline.mountedFlowPaths);
    expect(after.focusedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isFocused: true,
          isSticky: true,
          path: 'arch/arc/boot/dts/',
        }),
      ])
    );
  });

  test('ArrowUp from a sticky folder focuses the previous sticky folder without shifting the list', async ({
    page,
  }) => {
    const baseline = await prepareLinuxArcStickyStack(page, 'arch/arc/boot/');

    await page.keyboard.press('ArrowUp');
    await nextFrames(page);

    const after = await sample(page);
    expect(after.focusedPath).toBe('arch/arc/');
    expect(after.activeElementPath).toBe('arch/arc/');
    expect(after.scrollTop).toBe(baseline.scrollTop);
    expect(after.stickyPaths).toEqual(baseline.stickyPaths);
    expect(after.mountedFlowPaths).toEqual(baseline.mountedFlowPaths);
    expect(after.focusedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isFocused: true,
          isSticky: true,
          path: 'arch/arc/',
        }),
      ])
    );
  });

  test('ArrowUp from a sticky folder whose previous list item is outside the sticky stack follows logical row order', async ({
    page,
  }) => {
    const baseline = await prepareLinuxArcIncludeStickyStack(page, 'arch/arc/');
    const sourceProxyTop = getFocusedKeyboardProxyTop(baseline);

    await page.keyboard.press('ArrowUp');
    await nextFrames(page);

    const after = await sample(page);
    const targetPath = 'arch/alpha/Makefile';
    const targetRow = after.rows.find(
      (row) => row.path === targetPath && !row.isSticky && !row.isParked
    );
    expect(after.focusedPath).toBe(targetPath);
    expect(after.activeElementPath).toBe(targetPath);
    expect(after.activeElementIsSticky).toBe(false);
    expect(after.stickyPaths).not.toContain('arch/arc/');
    expect(after.mountedFlowPaths).toContain(targetPath);
    expect(targetRow).toBeDefined();
    expect(targetRow?.topWithinScroll).toBeCloseTo(sourceProxyTop, 1);
  });

  test('ArrowDown from the deepest sticky folder reveals its first child below the overlay', async ({
    page,
  }) => {
    await prepareLinuxArcStickyStack(page, 'arch/arc/boot/dts/');

    await page.keyboard.press('ArrowDown');
    await nextFrames(page);

    const after = await sample(page);
    const targetPath = 'arch/arc/boot/dts/abilis_tb10x.dtsi';
    const targetRow = after.rows.find(
      (row) => row.path === targetPath && !row.isSticky && !row.isParked
    );
    expect(after.focusedPath).toBe(targetPath);
    expect(after.mountedFlowPaths[0]).toBe(targetPath);
    expect(targetRow).toBeDefined();
    expect(targetRow?.topWithinScroll).toBeGreaterThanOrEqual(
      after.stickyOverlayBottomWithinScroll
    );
    expect(after.mountedFlowPaths).not.toContain('arch/alpha/Makefile');
    expect(after.mountedFlowPaths).not.toContain('arch/arc/');
  });

  test('ArrowDown from the synthetic b2 sticky folder keeps b2 in the second sticky slot', async ({
    page,
  }) => {
    const baseline = await prepareSyntheticBranchStickyStack(page, 'a1/b2/');

    await page.keyboard.press('ArrowDown');
    await nextFrames(page);

    const after = await sample(page);
    expectSyntheticBranchStickyStackPreserved(after, baseline, 'a1/b2/c1/');
  });

  test('ArrowUp from the synthetic b2 sticky folder follows previous branch content instead of the visual parent', async ({
    page,
  }) => {
    const baseline = await prepareSyntheticBranchStickyStack(page, 'a1/b2/');
    const sourceProxyTop = getFocusedKeyboardProxyTop(baseline);

    await page.keyboard.press('ArrowUp');
    await nextFrames(page);

    const after = await sample(page);
    const focusedPath = after.focusedPath;
    expect(focusedPath).not.toBeNull();
    expect(focusedPath?.startsWith('a1/b1/')).toBe(true);
    expect(focusedPath).not.toBe('a1/');
    expect(after.activeElementPath).toBe(focusedPath);
    expect(after.activeElementIsSticky).toBe(false);
    expect(after.stickyPaths).not.toContain('a1/b2/');
    const targetRow = after.rows.find(
      (row) => row.path === focusedPath && !row.isSticky && !row.isParked
    );
    expect(targetRow).toBeDefined();
    expect(targetRow?.topWithinScroll).toBeCloseTo(sourceProxyTop, 1);
  });

  test('ArrowDown from a focused synthetic sticky DOM mirror keeps b2 in the second sticky slot', async ({
    page,
  }) => {
    await gotoFixture(page, '?scenario=synthetic-branch');
    await setScrollTop(page, syntheticBranchScrollTop);
    await focusStickyDomOnly(page, 'a1/b2/');

    const baseline = await sample(page);
    expect(baseline.scrollTop).toBe(syntheticBranchScrollTop);
    expect(baseline.stickyPaths).toEqual([...syntheticBranchStickyPaths]);
    expect(baseline.activeElementPath).toBe('a1/b2/');
    expect(baseline.activeElementIsSticky).toBe(true);
    expect(baseline.mountedFlowPaths[0]).toBe('a1/b2/c1/d2/file_5');

    await page.keyboard.press('ArrowDown');
    await nextFrames(page);

    expectSyntheticBranchStickyStackPreserved(
      await sample(page),
      baseline,
      'a1/b2/c1/'
    );
  });

  test('ArrowRight from an expanded synthetic sticky folder preserves the sticky viewport', async ({
    page,
  }) => {
    const baseline = await prepareSyntheticBranchStickyStack(page, 'a1/b2/');

    await page.keyboard.press('ArrowRight');
    await nextFrames(page);

    expectSyntheticBranchStickyStackPreserved(
      await sample(page),
      baseline,
      'a1/b2/c1/'
    );
  });

  test('ArrowRight from the deepest synthetic sticky folder reveals its first file below the overlay', async ({
    page,
  }) => {
    await prepareSyntheticBranchStickyStack(page, 'a1/b2/c1/d2/');

    await page.keyboard.press('ArrowRight');
    await nextFrames(page);

    const after = await sample(page);
    const targetPath = 'a1/b2/c1/d2/file_1';
    const targetRow = getMountedFlowRow(after, targetPath);
    expect(after.focusedPath).toBe(targetPath);
    expect(after.activeElementPath).toBe(targetPath);
    expect(after.activeElementIsSticky).toBe(false);
    expect(after.stickyPaths).toEqual([...syntheticBranchStickyPaths]);
    expect(after.mountedFlowPaths[0]).toBe(targetPath);
    expect(targetRow).not.toBeNull();
    expect(targetRow?.topWithinScroll).toBeGreaterThanOrEqual(
      after.stickyOverlayBottomWithinScroll
    );
  });

  test('ArrowLeft from an expanded sticky folder collapses it without leaving child rows above focus', async ({
    page,
  }) => {
    const baseline = await prepareSyntheticBranchStickyStack(page, 'a1/b2/');
    const sourceProxyTop = getFocusedKeyboardProxyTop(baseline);

    await page.keyboard.press('ArrowLeft');
    await nextFrames(page);

    const after = await sample(page);
    const targetRow = getMountedFlowRow(after, 'a1/b2/');
    expect(after.focusedPath).toBe('a1/b2/');
    expect(after.activeElementPath).toBe('a1/b2/');
    expect(after.activeElementIsSticky).toBe(false);
    expect(after.stickyPaths).not.toContain('a1/b2/');
    expect(after.stickyPaths).not.toContain('a1/b2/c1/');
    expect(after.mountedFlowPaths).not.toContain('a1/b2/c1/');
    expect(after.mountedFlowPaths).not.toContain('a1/b2/c1/d2/file_5');
    expect(targetRow).not.toBeNull();
    expect(targetRow?.topWithinScroll).toBeCloseTo(sourceProxyTop, 1);
  });

  test('ArrowLeft from a nested expanded sticky folder drops descendant sticky rows without hiding focus', async ({
    page,
  }) => {
    const baseline = await prepareSyntheticBranchStickyStack(page, 'a1/b2/c1/');
    const sourceProxyTop = getFocusedKeyboardProxyTop(baseline);

    await page.keyboard.press('ArrowLeft');
    await nextFrames(page);

    const after = await sample(page);
    const targetRow = getMountedFlowRow(after, 'a1/b2/c1/');
    expect(after.focusedPath).toBe('a1/b2/c1/');
    expect(after.activeElementPath).toBe('a1/b2/c1/');
    expect(after.activeElementIsSticky).toBe(false);
    expect(after.stickyPaths).toContain('a1/');
    expect(after.stickyPaths).not.toContain('a1/b2/c1/');
    expect(after.stickyPaths).not.toContain('a1/b2/c1/d2/');
    expect(after.mountedFlowPaths).not.toContain('a1/b2/c1/d2/');
    expect(after.mountedFlowPaths).not.toContain('a1/b2/c1/d2/file_5');
    expect(targetRow).not.toBeNull();
    expect(targetRow?.topWithinScroll).toBeCloseTo(sourceProxyTop, 1);
  });

  test('second ArrowLeft after collapsing a sticky folder follows parent navigation', async ({
    page,
  }) => {
    await prepareSyntheticBranchStickyStack(page, 'a1/b2/');

    await page.keyboard.press('ArrowLeft');
    await nextFrames(page);
    const afterCollapse = await sample(page);
    expect(afterCollapse.focusedPath).toBe('a1/b2/');
    expect(afterCollapse.activeElementPath).toBe('a1/b2/');
    expect(afterCollapse.activeElementIsSticky).toBe(false);

    await page.keyboard.press('ArrowLeft');
    await nextFrames(page);

    const afterParent = await sample(page);
    expect(afterParent.focusedPath).toBe('a1/');
    expect(afterParent.activeElementPath).toBe('a1/');
    expect(afterParent.stickyPaths).not.toContain('a1/b2/');
  });

  test('Shift+ArrowDown from a synthetic sticky folder preserves the sticky viewport while extending selection', async ({
    page,
  }) => {
    const baseline = await prepareSyntheticBranchStickyStack(page, 'a1/b2/');

    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');
    await nextFrames(page);

    expectSyntheticBranchStickyStackPreserved(
      await sample(page),
      baseline,
      'a1/b2/c1/'
    );
  });

  test('Shift+ArrowUp from a synthetic sticky folder preserves the sticky viewport while extending selection', async ({
    page,
  }) => {
    const baseline = await prepareSyntheticBranchStickyStack(page, 'a1/b2/c1/');

    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Shift');
    await nextFrames(page);

    expectSyntheticBranchStickyStackPreserved(
      await sample(page),
      baseline,
      'a1/b2/'
    );
  });

  test('ArrowDown from the deepest synthetic sticky folder still reveals its first file below the overlay', async ({
    page,
  }) => {
    await prepareSyntheticBranchStickyStack(page, 'a1/b2/c1/d2/');

    await page.keyboard.press('ArrowDown');
    await nextFrames(page);

    const after = await sample(page);
    const targetPath = 'a1/b2/c1/d2/file_1';
    const targetRow = after.rows.find(
      (row) => row.path === targetPath && !row.isSticky && !row.isParked
    );
    expect(after.focusedPath).toBe(targetPath);
    expect(after.stickyPaths).toEqual([...syntheticBranchStickyPaths]);
    expect(after.mountedFlowPaths[0]).toBe(targetPath);
    expect(targetRow).toBeDefined();
    expect(targetRow?.topWithinScroll).toBeGreaterThanOrEqual(
      after.stickyOverlayBottomWithinScroll
    );
  });

  test('clicking a non-root sticky folder collapses it at the same visual top with a fractional scrollport', async ({
    page,
  }) => {
    const baseline = await prepareSyntheticBranchStickyStack(
      page,
      'a1/b2/',
      '?scenario=synthetic-branch&fractional-header=true'
    );
    const sourceStickyRow = getStickyRow(baseline, 'a1/b2/');
    expect(sourceStickyRow).not.toBeNull();
    if (sourceStickyRow == null) {
      throw new Error('Missing source sticky row for a1/b2/.');
    }

    await page.waitForTimeout(80);
    await page
      .locator(
        'file-tree-container button[data-file-tree-sticky-row="true"][data-file-tree-sticky-path="a1/b2/"]'
      )
      .click();
    await nextFrames(page);

    const after = await sample(page);
    const targetRow = getMountedFlowRow(after, 'a1/b2/');
    expect(after.focusedPath).toBe('a1/b2/');
    expect(after.activeElementPath).toBe('a1/b2/');
    expect(after.activeElementIsSticky).toBe(false);
    expect(after.stickyPaths).not.toContain('a1/b2/');
    expect(targetRow).not.toBeNull();
    expect(targetRow?.topWithinScroll).toBeCloseTo(
      sourceStickyRow.topWithinScroll,
      2
    );
  });

  test('clicking a linux non-root sticky folder collapses it at the same visual top', async ({
    page,
  }) => {
    const baseline = await prepareLinuxArcStickyStack(page, 'arch/arc/');
    const sourceStickyRow = getStickyRow(baseline, 'arch/arc/');
    expect(sourceStickyRow).not.toBeNull();
    if (sourceStickyRow == null) {
      throw new Error('Missing source sticky row for arch/arc/.');
    }

    await page.waitForTimeout(80);
    await page
      .locator(
        'file-tree-container button[data-file-tree-sticky-row="true"][data-file-tree-sticky-path="arch/arc/"]'
      )
      .click();
    await nextFrames(page);

    const after = await sample(page);
    const targetRow = getMountedFlowRow(after, 'arch/arc/');
    expect(after.focusedPath).toBe('arch/arc/');
    expect(after.activeElementPath).toBe('arch/arc/');
    expect(after.activeElementIsSticky).toBe(false);
    expect(after.stickyPaths).not.toContain('arch/arc/');
    expect(targetRow).not.toBeNull();
    expect(targetRow?.topWithinScroll).toBeCloseTo(
      sourceStickyRow.topWithinScroll,
      2
    );
  });
});
