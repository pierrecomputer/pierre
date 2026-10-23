import { expect, type Page, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(5);
});

const host = (page: Page, id: string) =>
  page.locator(`[data-layout-pane="${id}"]`);

test('a hidden pane keeps its content and shows again in its place', async ({
  page,
}) => {
  const terminal = host(page, 'terminal');
  const before = await terminal.boundingBox();
  // Mark the content, so that a new mount would lose the mark.
  await terminal
    .locator('.agent-terminal')
    .evaluate((element) => element.setAttribute('data-kept', 'yes'));

  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(terminal).toHaveAttribute('data-collapsed', 'true');
  await expect(terminal).toHaveAttribute('inert', '');
  expect(
    await terminal.evaluate(
      (element) => getComputedStyle(element).contentVisibility
    )
  ).toBe('hidden');
  // The editor above it takes its space.
  const editor = await host(page, 'editor').boundingBox();
  expect(editor?.height).toBeGreaterThan((before?.height ?? 0) + 100);

  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(terminal).toHaveAttribute('data-collapsed', 'false');
  await expect(terminal.locator('.agent-terminal')).toHaveAttribute(
    'data-kept',
    'yes'
  );
  const after = await terminal.boundingBox();
  expect(after?.height).toBeCloseTo(before?.height ?? 0, 0);
});

test('the close button of a tool hides it, and each pane has its own buttons', async ({
  page,
}) => {
  await expect(host(page, 'sessions').locator('header button')).toHaveCount(0);
  await expect(
    host(page, 'agent').getByRole('button', { name: /^Close / })
  ).toHaveCount(0);
  await expect(
    host(page, 'agent').getByRole('button', { name: /^Drag / })
  ).toHaveCount(1);
  for (const id of ['editor', 'terminal', 'files'])
    await expect(host(page, id).locator('header button')).toHaveCount(3);

  await page.getByRole('button', { name: 'Close Files', exact: true }).click();
  await expect(host(page, 'files')).toHaveAttribute('data-collapsed', 'true');
  await expect(
    page.getByRole('button', { name: 'Files', exact: true })
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(host(page, 'files')).toHaveAttribute('data-collapsed', 'false');
});
