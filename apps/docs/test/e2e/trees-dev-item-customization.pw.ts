import { expect, test } from '@playwright/test';

interface RowLaneState {
  containsGitChange: boolean;
  decorationIcon: string | null;
  decorationText: string | null;
  gitLabel: string | null;
  gitStatus: string | null;
  hasActionLane: boolean;
  hasDecorativeActionAffordance: boolean;
  hasGitDot: boolean;
}

interface TriggerAffordanceGeometry {
  decorativeCenterX: number;
  triggerCenterX: number;
}

interface VisibleTreeState {
  expanded: string | null;
  paths: string[];
}

async function readRowLaneState(
  page: import('@playwright/test').Page,
  rowPath: string
): Promise<RowLaneState | null> {
  return page.evaluate((targetRowPath) => {
    const host = document.querySelector('file-tree-container');
    const shadowRoot = host?.shadowRoot;
    const row = shadowRoot?.querySelector<HTMLElement>(
      `button[data-type="item"][data-item-path="${targetRowPath}"]`
    );
    if (!(row instanceof HTMLElement)) {
      return null;
    }

    const decorationSection = row.querySelector(
      '[data-item-section="decoration"]'
    );
    const gitSection = row.querySelector('[data-item-section="git"]');
    const actionSection = row.querySelector('[data-item-section="action"]');
    const decorationText = decorationSection?.textContent?.trim() ?? null;
    const gitText = gitSection?.textContent?.trim() ?? null;
    return {
      containsGitChange:
        row.getAttribute('data-item-contains-git-change') === 'true',
      decorationIcon:
        decorationSection
          ?.querySelector('[data-icon-name]')
          ?.getAttribute('data-icon-name') ?? null,
      decorationText: decorationText === '' ? null : decorationText,
      gitLabel: gitText === '' ? null : gitText,
      gitStatus: row.getAttribute('data-item-git-status'),
      hasActionLane: actionSection != null,
      hasDecorativeActionAffordance:
        row.querySelector('[data-item-action-affordance="decorative"]') != null,
      hasGitDot:
        gitSection?.querySelector('[data-icon-name="file-tree-icon-dot"]') !=
        null,
    } satisfies RowLaneState;
  }, rowPath);
}

async function readTriggerAffordanceGeometry(
  page: import('@playwright/test').Page,
  rowPath: string
): Promise<TriggerAffordanceGeometry | null> {
  return page.evaluate((targetRowPath) => {
    const host = document.querySelector('file-tree-container');
    const shadowRoot = host?.shadowRoot;
    const row = shadowRoot?.querySelector<HTMLElement>(
      `button[data-type="item"][data-item-path="${targetRowPath}"]`
    );
    const trigger = shadowRoot?.querySelector<HTMLElement>(
      'button[data-type="context-menu-trigger"][data-visible="true"]'
    );
    const decorativeAffordance = row?.querySelector<HTMLElement>(
      '[data-item-action-affordance="decorative"]'
    );
    if (
      !(row instanceof HTMLElement) ||
      !(trigger instanceof HTMLElement) ||
      !(decorativeAffordance instanceof HTMLElement)
    ) {
      return null;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const decorativeRect = decorativeAffordance.getBoundingClientRect();
    return {
      decorativeCenterX: decorativeRect.left + decorativeRect.width / 2,
      triggerCenterX: triggerRect.left + triggerRect.width / 2,
    } satisfies TriggerAffordanceGeometry;
  }, rowPath);
}

async function readVisibleTreeState(
  page: import('@playwright/test').Page,
  folderPath: string
): Promise<VisibleTreeState | null> {
  return page.evaluate((targetFolderPath) => {
    const host = document.querySelector('file-tree-container');
    const shadowRoot = host?.shadowRoot;
    const folderRow = shadowRoot?.querySelector<HTMLElement>(
      `button[data-type="item"][data-item-path="${targetFolderPath}"]`
    );
    if (!(folderRow instanceof HTMLElement)) {
      return null;
    }

    return {
      expanded: folderRow.getAttribute('aria-expanded'),
      paths: Array.from(
        shadowRoot?.querySelectorAll<HTMLButtonElement>(
          'button[data-type="item"]'
        ) ?? []
      )
        .map((row) => row.dataset.itemPath)
        .filter((path): path is string => path != null),
    } satisfies VisibleTreeState;
  }, folderPath);
}

test.describe('trees-dev item customization route', () => {
  test('preserves selected-file decoration while switching composition controls', async ({
    page,
  }) => {
    await page.goto('/trees-dev/item-customization');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Item Customization' })
    ).toBeVisible();

    const tree = page.locator('file-tree-container').first();
    const appRow = tree.locator(
      'button[data-type="item"][data-item-path="alpha/src/app.ts"]'
    );
    await expect(appRow).toBeVisible();

    await expect(
      page.locator('[data-test-item-customization-button-visibility="true"]')
    ).toBeDisabled();
    await expect
      .poll(() => readRowLaneState(page, 'alpha/src/app.ts'))
      .toEqual(
        expect.objectContaining({
          decorationText: 'App',
          gitLabel: 'A',
          gitStatus: 'added',
          hasActionLane: false,
          hasDecorativeActionAffordance: false,
        })
      );

    await page
      .locator('[data-test-item-customization-trigger-mode="true"]')
      .selectOption('both');
    await expect(
      page.locator('[data-test-item-customization-button-visibility="true"]')
    ).toBeEnabled();
    await expect(
      page.locator('[data-test-item-customization-button-visibility="true"]')
    ).toHaveValue('when-needed');
    await expect
      .poll(() => readRowLaneState(page, 'alpha/src/app.ts'))
      .toEqual(
        expect.objectContaining({
          hasActionLane: true,
          hasDecorativeActionAffordance: false,
        })
      );

    await page
      .locator('[data-test-item-customization-button-visibility="true"]')
      .selectOption('always');

    await appRow.hover();
    await expect
      .poll(() => readTriggerAffordanceGeometry(page, 'alpha/src/app.ts'))
      .toEqual(
        expect.objectContaining({
          decorativeCenterX: expect.any(Number),
          triggerCenterX: expect.any(Number),
        })
      );
    const triggerAffordanceGeometry = await readTriggerAffordanceGeometry(
      page,
      'alpha/src/app.ts'
    );
    expect(triggerAffordanceGeometry).not.toBeNull();
    expect(
      Math.abs(
        triggerAffordanceGeometry!.triggerCenterX -
          triggerAffordanceGeometry!.decorativeCenterX
      )
    ).toBeLessThanOrEqual(1.5);

    await appRow.click();
    await expect(
      page.locator('[data-test-item-customization-selected-paths="true"]')
    ).toContainText('alpha/src/app.ts');

    await page
      .locator('[data-test-item-customization-decoration-preset="true"]')
      .selectOption('selected-icons');

    await expect
      .poll(
        async () =>
          (await readRowLaneState(page, 'alpha/src/app.ts'))?.decorationIcon
      )
      .toBe('trees-dev-item-app');
    await expect
      .poll(
        async () =>
          (await readRowLaneState(page, 'alpha/src/app.ts'))?.decorationText
      )
      .toBeNull();

    await page
      .locator('[data-test-item-customization-trigger-mode="true"]')
      .selectOption('right-click');
    await expect(
      page.locator('[data-test-item-customization-button-visibility="true"]')
    ).toBeDisabled();
    await expect
      .poll(
        async () =>
          (await readRowLaneState(page, 'alpha/src/app.ts'))?.hasActionLane
      )
      .toBe(false);

    await appRow.click({ button: 'right' });
    await expect(
      page.locator('[data-test-item-customization-menu="true"]')
    ).toBeVisible();
    await page.getByRole('menuitem', { name: 'Inspect row' }).click();
    await expect(
      page.locator('[data-test-item-customization-last-menu-action="true"]')
    ).toContainText('Inspect row: alpha/src/app.ts');
  });

  test('selection clicks preserve collapsed expansion state and visible row order', async ({
    page,
  }) => {
    await page.goto('/trees-dev/item-customization');

    const tree = page.locator('file-tree-container').first();
    const srcFolder = tree.locator(
      'button[data-type="item"][data-item-path="alpha/src/"]'
    );
    const keepRow = tree.locator(
      'button[data-type="item"][data-item-path="beta/keep.txt"]'
    );

    await expect(srcFolder).toBeVisible();
    await expect(keepRow).toBeVisible();

    await srcFolder.focus();
    await srcFolder.press('ArrowLeft');
    await expect
      .poll(() => readVisibleTreeState(page, 'alpha/src/'))
      .toEqual(
        expect.objectContaining({
          expanded: 'false',
          paths: expect.any(Array),
        })
      );

    const collapsedTreeState = await readVisibleTreeState(page, 'alpha/src/');
    expect(collapsedTreeState).not.toBeNull();
    expect(collapsedTreeState!.paths).not.toContain('alpha/src/app.ts');
    expect(collapsedTreeState!.paths).not.toContain('alpha/src/utils/math.ts');

    await keepRow.click();
    await expect(
      page.locator('[data-test-item-customization-selected-paths="true"]')
    ).toContainText('beta/keep.txt');
    await expect
      .poll(() => readVisibleTreeState(page, 'alpha/src/'))
      .toEqual(collapsedTreeState);
  });

  test('shared git-status presets drive both the customization route and git-status page', async ({
    page,
  }) => {
    await page.goto('/trees-dev/item-customization');

    await page
      .locator('[data-test-item-customization-git-status-preset="true"]')
      .selectOption('ignored-and-overrides');

    await expect
      .poll(async () => (await readRowLaneState(page, 'beta/'))?.gitStatus)
      .toBe('ignored');
    await expect
      .poll(async () => (await readRowLaneState(page, 'beta/'))?.gitLabel)
      .toBeNull();
    await expect
      .poll(
        async () =>
          (await readRowLaneState(page, 'beta/archive/notes.txt'))?.gitLabel
      )
      .toBe('M');
    await expect
      .poll(
        async () => (await readRowLaneState(page, 'gamma/logs/'))?.hasGitDot
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await readRowLaneState(page, 'gamma/logs/'))?.containsGitChange
      )
      .toBe(true);

    await page.goto('/trees-dev/git-status');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Git Status' })
    ).toBeVisible();
    await expect(
      page
        .locator('file-tree-container')
        .first()
        .locator('button[data-type="item"][data-item-path="alpha/src/app.ts"]')
    ).toBeVisible();

    await page
      .locator('[data-test-git-status-preset="true"]')
      .selectOption('ignored-and-overrides');
    await expect(
      page.locator('[data-test-git-status-active-description="true"]')
    ).toContainText('ignored inheritance on beta/');
    await expect
      .poll(
        async () =>
          (await readRowLaneState(page, 'beta/archive/notes.txt'))?.gitLabel
      )
      .toBe('M');
    await expect
      .poll(
        async () => (await readRowLaneState(page, 'gamma/logs/'))?.hasGitDot
      )
      .toBe(true);
  });
});
