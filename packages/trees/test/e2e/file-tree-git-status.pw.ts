import { expect, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __fileTreeGitStatusFixtureReady?: boolean;
  }
}

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/file-tree-git-status.html');
  await page.waitForFunction(
    () => window.__fileTreeGitStatusFixtureReady === true
  );
}

async function readGitStatusSnapshot(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('file-tree-container');
    const shadowRoot = host?.shadowRoot;
    if (!(host instanceof HTMLElement) || !(shadowRoot instanceof ShadowRoot)) {
      return null;
    }

    const getItemButton = (path: string) =>
      shadowRoot.querySelector(`button[data-item-path="${path}"]`) as
        | HTMLButtonElement
        | undefined;
    const getStatusPayload = (path: string) => {
      const button = getItemButton(path);
      if (button == null) {
        return null;
      }
      const gitLabel =
        button
          .querySelector('[data-item-section="git"] > span')
          ?.textContent?.trim() ?? null;
      return {
        decoration:
          button
            .querySelector('[data-item-section="decoration"] > span')
            ?.textContent?.trim() ?? null,
        gitLabel,
        gitStatus: button.getAttribute('data-item-git-status'),
      };
    };

    const srcFolder = getItemButton('src/');
    return {
      hostCount: document.querySelectorAll('file-tree-container').length,
      state:
        document.querySelector('[data-file-tree-git-status-state]')
          ?.textContent ?? null,
      wrapperCount: shadowRoot.querySelectorAll(
        '[data-file-tree-virtualized-wrapper="true"]'
      ).length,
      readme: getStatusPayload('README.md'),
      packageJson: getStatusPayload('package.json'),
      index: getStatusPayload('src/index.ts'),
      button: getStatusPayload('src/components/Button.tsx'),
      card: getStatusPayload('src/components/Card.tsx'),
      worker: getStatusPayload('src/utils/worker.ts'),
      deleted: getStatusPayload('test/index.test.ts'),
      srcFolder:
        srcFolder == null
          ? null
          : {
              contains: srcFolder.getAttribute('data-item-contains-git-change'),
              dotHeight: srcFolder
                .querySelector(
                  '[data-item-section="git"] [data-icon-name="file-tree-icon-dot"]'
                )
                ?.getAttribute('height'),
              dotWidth: srcFolder
                .querySelector(
                  '[data-item-section="git"] [data-icon-name="file-tree-icon-dot"]'
                )
                ?.getAttribute('width'),
              hasOwnStatus: srcFolder.hasAttribute('data-item-git-status'),
              hasStatusDot:
                srcFolder.querySelector(
                  '[data-item-section="git"] [data-icon-name="file-tree-icon-dot"]'
                ) != null,
            },
      anyStatusCount: shadowRoot.querySelectorAll('[data-item-git-status]')
        .length,
      anyFolderChangeCount: shadowRoot.querySelectorAll(
        '[data-item-contains-git-change="true"]'
      ).length,
    };
  });
}

test.describe('file-tree git-status proof', () => {
  test('renders git-status attrs and updates them in place across set A, set B, and disabled states', async ({
    page,
  }) => {
    await openFixture(page);

    await expect
      .poll(() => readGitStatusSnapshot(page))
      .toMatchObject({
        hostCount: 1,
        wrapperCount: 1,
        state: 'enabled=true set=A',
        readme: { decoration: null, gitLabel: 'U', gitStatus: 'untracked' },
        packageJson: { decoration: null, gitLabel: 'R', gitStatus: 'renamed' },
        index: { decoration: 'TS', gitLabel: 'M', gitStatus: 'modified' },
        button: { decoration: null, gitLabel: 'A', gitStatus: 'added' },
        deleted: { decoration: null, gitLabel: 'D', gitStatus: 'deleted' },
        srcFolder: {
          contains: 'true',
          dotHeight: '6',
          dotWidth: '6',
          hasOwnStatus: false,
          hasStatusDot: true,
        },
      });

    await page.locator('[data-file-tree-git-status-action="set-b"]').click();

    await expect
      .poll(() => readGitStatusSnapshot(page))
      .toMatchObject({
        hostCount: 1,
        wrapperCount: 1,
        state: 'enabled=true set=B',
        readme: { decoration: null, gitLabel: 'M', gitStatus: 'modified' },
        packageJson: { decoration: null, gitLabel: null, gitStatus: null },
        index: { decoration: 'TS', gitLabel: null, gitStatus: null },
        button: { decoration: null, gitLabel: null, gitStatus: null },
        card: { decoration: null, gitLabel: null, gitStatus: 'ignored' },
        worker: { decoration: null, gitLabel: 'U', gitStatus: 'untracked' },
        deleted: { decoration: null, gitLabel: null, gitStatus: null },
        srcFolder: {
          contains: 'true',
          dotHeight: '6',
          dotWidth: '6',
          hasOwnStatus: false,
          hasStatusDot: true,
        },
      });

    await page
      .locator('[data-file-tree-git-status-action="toggle-enabled"]')
      .click();

    await expect
      .poll(() => readGitStatusSnapshot(page))
      .toMatchObject({
        hostCount: 1,
        wrapperCount: 1,
        state: 'enabled=false set=B',
        readme: { decoration: null, gitLabel: null, gitStatus: null },
        packageJson: { decoration: null, gitLabel: null, gitStatus: null },
        index: { decoration: 'TS', gitLabel: null, gitStatus: null },
        button: { decoration: null, gitLabel: null, gitStatus: null },
        card: { decoration: null, gitLabel: null, gitStatus: null },
        worker: { decoration: null, gitLabel: null, gitStatus: null },
        deleted: { decoration: null, gitLabel: null, gitStatus: null },
        anyStatusCount: 0,
        anyFolderChangeCount: 0,
      });
  });
});
