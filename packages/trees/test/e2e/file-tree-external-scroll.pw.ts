import { expect, type Page, test } from '@playwright/test';

type ExternalScrollSample = {
  belowTopWithinScroller: number;
  mountedPaths: string[];
  parentScrollTop: number;
  requestCount: number;
  requests: {
    context: {
      origin: 'programmatic';
      path?: string | null;
      reason: string;
    };
    viewportTop: number;
  }[];
  stickyPaths: string[];
  stickyTopWithinScroller: number | null;
  topInset: number;
};

declare global {
  interface Window {
    __externalScrollFixtureReady?: boolean;
    __externalScrollProbe?: {
      focusFirstRow: () => Promise<void>;
      nextFrames: (count?: number) => Promise<void>;
      pressFocusedRowKey: (key: string) => Promise<void>;
      sample: () => ExternalScrollSample;
      setScrollTop: (scrollTop: number) => Promise<void>;
    };
  }
}

const fixturePath = '/test/e2e/fixtures/file-tree-external-scroll.html';

async function gotoFixture(page: Page): Promise<void> {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => {
    browserErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });

  await page.goto(fixturePath);
  try {
    await page.waitForFunction(
      () => window.__externalScrollFixtureReady === true,
      undefined,
      { timeout: 5_000 }
    );
  } catch (error) {
    throw new Error(
      `External scroll fixture did not become ready. Browser errors: ${browserErrors.join(
        '\n'
      )}`,
      { cause: error }
    );
  }
}

async function setScrollTop(page: Page, scrollTop: number): Promise<void> {
  await page.evaluate((nextScrollTop) => {
    return window.__externalScrollProbe?.setScrollTop(nextScrollTop);
  }, scrollTop);
}

async function sample(page: Page): Promise<ExternalScrollSample> {
  const result = await page.evaluate(() => {
    return window.__externalScrollProbe?.sample() ?? null;
  });
  expect(result).not.toBeNull();
  if (result == null) {
    throw new Error('Missing external scroll sample.');
  }
  return result;
}

test.describe('external scroll fixture', () => {
  test('uses caller-owned scrolling with sticky folders and offscreen virtualization', async ({
    page,
  }) => {
    await gotoFixture(page);

    const aboveTree = await sample(page);
    expect(aboveTree.mountedPaths).toEqual([]);

    await setScrollTop(page, 520);
    const intersectingTree = await sample(page);
    expect(intersectingTree.mountedPaths.length).toBeGreaterThan(0);
    expect(intersectingTree.mountedPaths[0]).toMatch(/^src\//);

    await setScrollTop(page, 700);
    const stickyTree = await sample(page);
    expect(stickyTree.stickyPaths).toContain('src/');
    expect(stickyTree.stickyTopWithinScroller).not.toBeNull();
    expect(stickyTree.stickyTopWithinScroller ?? 0).toBeGreaterThanOrEqual(
      stickyTree.topInset - 1
    );

    await setScrollTop(page, 3_600);
    const belowTree = await sample(page);
    expect(belowTree.belowTopWithinScroller).toBeLessThan(360);
  });

  test('keyboard focus reveal requests parent scroll movement', async ({
    page,
  }) => {
    await gotoFixture(page);
    await setScrollTop(page, 520);
    const before = await sample(page);

    await page.evaluate(() => window.__externalScrollProbe?.focusFirstRow());
    await page.evaluate(() =>
      window.__externalScrollProbe?.pressFocusedRowKey('End')
    );

    const after = await sample(page);
    expect(after.requestCount).toBeGreaterThan(before.requestCount);
    const lastRequest = after.requests.at(-1);
    expect(lastRequest?.context).toEqual({
      origin: 'programmatic',
      path: 'z/file_023.ts',
      reason: 'focus-reveal',
    });
    expect(after.parentScrollTop).toBeGreaterThan(before.parentScrollTop);
  });
});
