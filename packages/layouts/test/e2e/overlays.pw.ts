import { expect, type Locator, type Page, test } from '@playwright/test';

// The modal strategies of `createModal`. The `/app` demo takes `?modal=`.
const STRATEGIES = ['dialog-hide-covered', 'dialog', 'popover'] as const;
const PANES = ['sessions', 'agent', 'editor', 'terminal', 'files'];

const host = (page: Page, id: string): Locator =>
  page.locator(`[data-layout-pane="${id}"]`);

async function load(page: Page, query = ''): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/app${query}`);
  await expect(page.locator('[data-layout-pane]')).toHaveCount(5);
}

/** Focus a header button and press Enter, as a keyboard user does. */
async function pressButton(page: Page, name: string): Promise<Locator> {
  const button = page.getByRole('button', { name, exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  return button;
}

/** Where the focus is: in the overlay, on the page outside it, or on the body. */
const focusPlace = (overlay: Locator): Promise<string> =>
  overlay.evaluate((element) =>
    document.activeElement === document.body || document.activeElement === null
      ? 'body'
      : element.contains(document.activeElement)
        ? 'inside'
        : 'outside'
  );

/** The pane regions that Chromium's accessibility tree exposes. */
async function exposedPaneRegions(page: Page): Promise<string[]> {
  const client = await page.context().newCDPSession(page);
  const { nodes } = await client.send('Accessibility.getFullAXTree');
  await client.detach();
  return nodes
    .filter((node) => node.role?.value === 'region' && node.ignored !== true)
    .map((node) => String(node.name?.value ?? ''));
}

for (const strategy of STRATEGIES) {
  test.describe(`a modal with the ${strategy} strategy`, () => {
    test.beforeEach(({ page }) => load(page, `?modal=${strategy}`));

    test('opens from the keyboard, keeps the focus, and returns it on Escape', async ({
      page,
    }) => {
      const trigger = await pressButton(page, 'Review changes');
      const modal = page.getByRole('dialog', { name: 'Review changes' });
      await expect(modal).toBeVisible();
      expect(await focusPlace(modal)).toBe('inside');

      // Tab and Shift+Tab never reach the page. After the last element of a
      // `<dialog>`, Chromium moves the focus to the browser, which is the body
      // in a headless page.
      for (const key of [
        ...Array(8).fill('Tab'),
        ...Array(4).fill('Shift+Tab'),
      ]) {
        await page.keyboard.press(key);
        expect(await focusPlace(modal)).not.toBe('outside');
      }

      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
      await expect(trigger).toBeFocused();
    });

    test('the close button closes the modal and returns the focus', async ({
      page,
    }) => {
      const trigger = await pressButton(page, 'Review changes');
      await page.getByRole('button', { name: 'Close review' }).press('Enter');
      await expect(
        page.getByRole('dialog', { name: 'Review changes' })
      ).toBeHidden();
      await expect(trigger).toBeFocused();
    });

    if (strategy === 'popover') {
      test('the panes around a popover modal leave the accessibility tree', async ({
        page,
      }) => {
        // Chromium keeps the page in its tree for `aria-modal`, so the
        // layout root gets `aria-hidden`. The panes are not inert: this is
        // the accessibility cost of the popover strategy.
        await pressButton(page, 'Review changes');
        await expect(
          page.getByRole('dialog', { name: 'Review changes' })
        ).toBeVisible();
        expect(await exposedPaneRegions(page)).toEqual([]);
        await expect(page.locator('.pierre-layout')).toHaveAttribute(
          'aria-hidden',
          'true'
        );
        await page.keyboard.press('Escape');
        await expect(page.locator('.pierre-layout')).not.toHaveAttribute(
          'aria-hidden'
        );
      });
    } else {
      test('the panes under the modal are inert and leave the accessibility tree', async ({
        page,
      }) => {
        await pressButton(page, 'Review changes');
        await expect(
          page.getByRole('dialog', { name: 'Review changes' })
        ).toBeVisible();
        // An inert element does not take the focus, also from a script.
        const button = host(page, 'editor').locator('header button').first();
        expect(
          await button.evaluate((element: HTMLElement) => {
            element.focus();
            return document.activeElement === element;
          })
        ).toBe(false);
        expect(await exposedPaneRegions(page)).toEqual([]);
      });
    }
  });
}

test('an opaque modal stops every pane from rendering until it closes', async ({
  page,
}) => {
  await load(page, '?backdrop=opaque');
  await page.evaluate(() => {
    const covers: unknown[] = [];
    (window as unknown as { covers: unknown[] }).covers = covers;
    document
      .querySelector('.pierre-layout')
      ?.addEventListener('pierre-layout-cover', (event) =>
        covers.push((event as CustomEvent).detail.covered)
      );
  });
  await pressButton(page, 'Review changes');
  await expect(
    page.getByRole('dialog', { name: 'Review changes' })
  ).toBeVisible();
  for (const id of PANES) {
    await expect(host(page, id)).toHaveAttribute(
      'data-overlay-covered',
      'true'
    );
    await expect(host(page, id)).toHaveAttribute('inert', '');
    expect(
      await host(page, id).evaluate(
        (element) => getComputedStyle(element).contentVisibility
      )
    ).toBe('hidden');
  }

  await page.keyboard.press('Escape');
  for (const id of PANES) {
    await expect(host(page, id)).not.toHaveAttribute('data-overlay-covered');
    await expect(host(page, id)).not.toHaveAttribute('inert');
  }
  const covers = await page.evaluate(
    () => (window as unknown as { covers: string[][] }).covers
  );
  expect(covers.map((covered) => covered.length)).toEqual([5, 0]);
});

test('the drawer opens from the keyboard, hides the pane that it covers, and returns the focus', async ({
  page,
}) => {
  await load(page);
  const trigger = await pressButton(page, 'Activity');
  const drawer = page.getByRole('dialog', { name: 'Activity' });
  await expect(drawer).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(await focusPlace(drawer)).toBe('inside');

  // The drawer covers the files pane completely, and the editor in part.
  await expect(host(page, 'files')).toHaveAttribute(
    'data-overlay-covered',
    'true'
  );
  await expect(host(page, 'files')).toHaveAttribute('inert', '');
  await expect(host(page, 'editor')).not.toHaveAttribute(
    'data-overlay-covered'
  );
  // The drawer is not modal: the other panes keep working.
  await host(page, 'agent')
    .getByRole('button', { name: /^Zoom / })
    .focus();
  await expect(
    host(page, 'agent').getByRole('button', { name: /^Zoom / })
  ).toBeFocused();

  await drawer.getByRole('button', { name: 'Close activity' }).focus();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(host(page, 'files')).not.toHaveAttribute('data-overlay-covered');
  await expect(host(page, 'files')).not.toHaveAttribute('inert');
});

test('overlays animate in and out on the compositor', async ({ page }) => {
  await load(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // The overlay animations of an element in the next frame, with their state.
  const animations = (selector: string) =>
    page.evaluate(
      (selector) =>
        new Promise<string[]>((resolve) => {
          requestAnimationFrame(() =>
            resolve(
              (document.querySelector(selector)?.getAnimations() ?? [])
                .filter(({ id }) => id === 'pierre-layout-overlay')
                .map(({ playState }) => playState)
            )
          );
        }),
      selector
    );

  await pressButton(page, 'Review changes');
  expect(await animations('.pierre-modal')).toContain('running');
  await page.keyboard.press('Escape');
  // Chromium keeps the closed `<dialog>` in the top layer during the exit.
  expect(await animations('.pierre-modal')).toContain('running');
  await expect(page.locator('.pierre-modal')).toBeHidden();
  expect(await animations('.pierre-modal')).toEqual([]);

  await pressButton(page, 'Activity');
  expect(await animations('.pierre-drawer')).toContain('running');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pierre-drawer')).toBeHidden();
  expect(await animations('.pierre-drawer')).toEqual([]);
});
