import { type CDPSession, expect, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __getDragState?: () => {
      dragging: string[];
      parked: string[];
      targets: string[];
    };
    __hasPath?: (path: string) => boolean;
    __getVisiblePaths?: () => string[];
    __getFlattenedSegments?: () => string[];
    __lastDropError?: {
      error: string;
      draggedPaths: string[];
      target: {
        directoryPath: string | null;
        flattenedSegmentPath: string | null;
        hoveredPath: string | null;
        kind: 'directory' | 'root';
      };
    } | null;
    __lastDropResult?: unknown;
    __pathStoreDragAndDropReady?: boolean;
  }
}

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/path-store-drag-and-drop.html');
  await page.waitForFunction(() => window.__pathStoreDragAndDropReady === true);
}

async function expectDragStateCleared(page: Page) {
  await page.waitForFunction(() => {
    const state = window.__getDragState?.();
    return (
      state != null && state.dragging.length === 0 && state.targets.length === 0
    );
  });
}

class TouchSession {
  readonly cdp: CDPSession;

  public constructor(cdp: CDPSession) {
    this.cdp = cdp;
  }

  static async create(page: Page): Promise<TouchSession> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
    return new TouchSession(cdp);
  }

  async touchStart(x: number, y: number) {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: Math.round(x), y: Math.round(y) }],
      modifiers: 0,
    });
  }

  async touchMove(x: number, y: number) {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(x), y: Math.round(y) }],
      modifiers: 0,
    });
  }

  async touchEnd() {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
      modifiers: 0,
    });
  }

  async touchCancel() {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
      modifiers: 0,
    });
  }

  async dispose() {
    await this.cdp.detach();
  }
}

test.describe('path-store drag-and-drop proof', () => {
  test('pointer drag moves a row into a folder and clears drag state', async ({
    page,
  }) => {
    await openFixture(page);

    const source = page.locator(
      'file-tree-container button[data-item-path="README.md"]'
    );
    const target = page.locator(
      'file-tree-container button[data-item-path="src/lib/"]'
    );

    await source.dragTo(target);
    await page.waitForFunction(
      () => window.__hasPath?.('src/lib/README.md') === true
    );
    await expect(
      page.locator(
        'file-tree-container button[data-item-path="src/lib/README.md"]'
      )
    ).toBeVisible();
    await expectDragStateCleared(page);
  });

  test('touch long-press drag moves a row with the path-store touch flow', async ({
    page,
  }) => {
    await openFixture(page);

    const source = page.locator(
      'file-tree-container button[data-item-path="package.json"]'
    );
    const target = page.locator(
      'file-tree-container button[data-item-path="docs/"]'
    );
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const touch = await TouchSession.create(page);
    try {
      await touch.touchStart(
        sourceBox!.x + sourceBox!.width / 2,
        sourceBox!.y + sourceBox!.height / 2
      );
      await page.waitForTimeout(500);
      await touch.touchMove(
        targetBox!.x + targetBox!.width / 2,
        targetBox!.y + targetBox!.height / 2
      );
      await page.waitForTimeout(100);
      await touch.touchEnd();
    } finally {
      await touch.dispose();
    }

    await page.waitForFunction(
      () => window.__hasPath?.('docs/package.json') === true
    );
    await expectDragStateCleared(page);
  });

  test('touch cancel clears drag and target state without mutating the tree', async ({
    page,
  }) => {
    await openFixture(page);

    const source = page.locator(
      'file-tree-container button[data-item-path="README.md"]'
    );
    const target = page.locator(
      'file-tree-container button[data-item-path="src/lib/"]'
    );
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const touch = await TouchSession.create(page);
    try {
      await touch.touchStart(
        sourceBox!.x + sourceBox!.width / 2,
        sourceBox!.y + sourceBox!.height / 2
      );
      await page.waitForTimeout(500);
      await touch.touchMove(
        targetBox!.x + targetBox!.width / 2,
        targetBox!.y + targetBox!.height / 2
      );
      await page.waitForTimeout(100);
      await touch.touchCancel();
    } finally {
      await touch.dispose();
    }

    await page.waitForFunction(() => window.__hasPath?.('README.md') === true);
    await expectDragStateCleared(page);
  });
});
