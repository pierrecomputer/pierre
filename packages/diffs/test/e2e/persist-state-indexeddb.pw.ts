import { expect, test } from '@playwright/test';

test('indexedDB storage restores state in a fresh editor', async ({ page }) => {
  await page.goto('/test/e2e/fixtures/persist-state-indexeddb.html');

  const result = page.locator('[data-persist-state-result]');
  await expect(result).toHaveAttribute('data-status', 'ready');
  await expect(result).toHaveAttribute('data-stored-character', '3');
  await expect(result).toHaveAttribute('data-restored-character', '3');
});
