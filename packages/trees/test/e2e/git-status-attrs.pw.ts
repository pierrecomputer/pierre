import { expect, type Page, test } from '@playwright/test';

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/git-status.html');
  await page.waitForFunction(() => window.__fileTreeFixtureReady === true);
}

test.describe('file-tree git status attributes', () => {
  test('renders status attributes and indicators on the shadow DOM nodes', async ({
    page,
  }) => {
    await openFixture(page);

    const statusData = await page.evaluate(() => {
      const host = document.getElementById('git-status-host');
      const root = host?.shadowRoot;
      if (root == null) {
        return null;
      }

      const getItemButton = (label: string) =>
        Array.from(root.querySelectorAll('button[data-type="item"]')).find(
          (button) =>
            button
              .querySelector("[data-item-section='content']")
              ?.textContent?.trim() === label
        ) as HTMLButtonElement | undefined;

      const getStatusPayload = (label: string) => {
        const button = getItemButton(label);
        if (button == null) return null;
        return {
          gitStatus: button.getAttribute('data-item-git-status'),
          label: button
            .querySelector("[data-item-section='status']")
            ?.textContent?.trim(),
        };
      };

      const srcFolder = getItemButton('src');

      return {
        index: getStatusPayload('index.ts'),
        button: getStatusPayload('Button.tsx'),
        deleted: getStatusPayload('index.test.ts'),
        srcFolder:
          srcFolder == null
            ? null
            : {
                contains: srcFolder.getAttribute(
                  'data-item-contains-git-change'
                ),
                hasOwnStatus: srcFolder.hasAttribute('data-item-git-status'),
                hasStatusDot:
                  srcFolder.querySelector(
                    '[data-icon-name="file-tree-icon-dot"]'
                  ) != null,
              },
      };
    });

    expect(statusData).not.toBeNull();
    expect(statusData?.index).toEqual({
      gitStatus: 'modified',
      label: 'M',
    });
    expect(statusData?.button).toEqual({
      gitStatus: 'added',
      label: 'A',
    });
    expect(statusData?.deleted).toEqual({
      gitStatus: 'deleted',
      label: 'D',
    });
    expect(statusData?.srcFolder).toEqual({
      contains: 'true',
      hasOwnStatus: false,
      hasStatusDot: true,
    });
  });
});

declare global {
  interface Window {
    __fileTreeFixtureReady?: boolean;
  }
}
