import { expect, test } from '@playwright/test';

const full = `const long = '${'wide '.repeat(50)}';`;
const visible = full.slice(0, 113);

for (const overflow of ['scroll', 'wrap']) {
  test(
    overflow +
      ' places the button after the visible text and copies just that text',
    async ({ page }) => {
      await page.goto('/test/e2e/fixtures/row-layout.html?cut');
      await page.locator('[data-' + overflow + ']').click();
      const code = page.locator('[data-code]');
      const row = code.locator('[data-line="3"]');
      const button = row.getByRole('button', { name: 'Show full line' });
      await expect(button).toBeVisible();
      await expect(row).toHaveText(visible, { useInnerText: false });

      const positions = await row.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let last: Node | null = null;
        for (
          let node = walker.nextNode();
          node != null;
          node = walker.nextNode()
        )
          last = node;
        const expand = el.querySelector('button');
        if (!(last instanceof Text) || expand == null)
          throw new Error('Missing visible text or button');
        const range = document.createRange();
        range.setStart(last, last.length - 1);
        range.setEnd(last, last.length);
        const text = range.getBoundingClientRect();
        const control = expand.getBoundingClientRect();
        return {
          gap: control.left - text.right,
          characterWidth: text.width,
          textMiddle: text.top + text.height / 2,
          buttonMiddle: control.top + control.height / 2,
        };
      });
      // Right after the text: not over it, and less than a character away.
      expect(positions.gap).toBeGreaterThan(-1);
      expect(positions.gap).toBeLessThan(positions.characterWidth);
      expect(
        Math.abs(positions.buttonMiddle - positions.textMiddle)
      ).toBeLessThan(2);

      const selected = await row.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return selection?.toString();
      });
      expect(selected).toBe(visible);
      await page.keyboard.press('ControlOrMeta+c');
      await page.evaluate(() => {
        const pasted = document.createElement('textarea');
        document.body.appendChild(pasted);
        pasted.focus();
      });
      await page.keyboard.press('ControlOrMeta+v');
      await expect(page.locator('textarea')).toHaveValue(visible);

      const below = code.locator('[data-line="4"]');
      const before = await row.boundingBox();
      const nextBefore = await below.boundingBox();
      const width = await code.evaluate((el) => el.scrollWidth);
      await button.click();
      await expect(row).toHaveText(full);
      await expect(button).toHaveCount(0);
      if (overflow === 'scroll') {
        expect(await code.evaluate((el) => el.scrollWidth)).toBeGreaterThan(
          width
        );
      } else {
        const after = await row.boundingBox();
        const next = await below.boundingBox();
        if (
          before == null ||
          nextBefore == null ||
          after == null ||
          next == null
        )
          throw new Error('Missing row bounds');
        expect(after.height).toBeGreaterThan(before.height);
        expect(next.y).toBeGreaterThan(nextBefore.y);
        expect(next.y).toBeGreaterThanOrEqual(after.y + after.height - 0.5);
      }
    }
  );
}

test('Tab focuses the expansion button and Enter shows the full line', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/row-layout.html?cut');
  const button = page.getByRole('button', { name: 'Show full line' });
  await expect(button).toBeVisible();
  await page.locator('[data-clear-css]').focus();
  // Scrollable columns can themselves be tab stops.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    if (await button.evaluate((el) => el.matches(':focus'))) break;
  }
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-line="3"]')).toHaveText(full);
  await expect(button).toHaveCount(0);
});
