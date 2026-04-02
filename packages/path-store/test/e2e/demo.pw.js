import { expect, test } from '@playwright/test';

function getRowsLocator(page) {
  return page.locator('#rows');
}

async function getRenderedRows(page) {
  const text = await getRowsLocator(page).innerText();
  return text === '' ? [] : text.split('\n');
}

async function getExpectedRows(page) {
  return page.evaluate(() => {
    const demo = window.pathStoreDemo;
    if (demo == null || demo.store == null) {
      return [];
    }

    const visibleCountInput = document.querySelector('#visible-count');
    const offsetInput = document.querySelector('#offset');
    if (
      !(visibleCountInput instanceof HTMLInputElement) ||
      !(offsetInput instanceof HTMLInputElement)
    ) {
      throw new Error('Missing demo controls.');
    }

    const visibleCount = Number(visibleCountInput.value);
    const offset = Number(offsetInput.value);
    const end = offset + visibleCount - 1;

    return demo.store.getVisibleSlice(offset, end).map((row) => row.path);
  });
}

async function expectRenderedRowsToMatchStore(page) {
  await expect
    .poll(async () => ({
      expected: await getExpectedRows(page),
      rendered: await getRenderedRows(page),
    }))
    .toEqual({
      expected: await getExpectedRows(page),
      rendered: await getExpectedRows(page),
    });
}

async function renderDemo(page, workload = 'linux') {
  await page.goto('/');
  await expect(getRowsLocator(page)).toHaveText('');
  await expect(page.locator('#offset')).toBeDisabled();

  await page.locator('#workload').selectOption(workload);
  await page.getByRole('button', { name: 'Render' }).click();

  await expect
    .poll(() => getRenderedRows(page).then((rows) => rows.length))
    .toBe(30);
  await expect(page.locator('#offset')).toBeEnabled();
  await expectRenderedRowsToMatchStore(page);
}

async function setOffset(page, value) {
  await page.locator('#offset').evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('Offset control is not an input.');
    }

    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function prepareAction(page, actionId) {
  return page.evaluate((nextActionId) => {
    const demo = window.pathStoreDemo;
    if (demo == null) {
      throw new Error('Missing demo API.');
    }

    return {
      prepared: demo.prepareAction(nextActionId).prepared,
    };
  }, actionId);
}

async function getCurrentVisibleCount(page) {
  return page.evaluate(
    () => window.pathStoreDemo?.store.getVisibleCount() ?? 0
  );
}

function trackPageErrors(page) {
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error);
  });
  return pageErrors;
}

test('renders the initial window and responds to visible-count and offset controls', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page);

  await page.locator('#visible-count').fill('50');
  await expect
    .poll(() => getRenderedRows(page).then((rows) => rows.length))
    .toBe(50);
  await expectRenderedRowsToMatchStore(page);

  await setOffset(page, 200);
  await expect(page.locator('#offset-value')).toHaveText('200');
  await expectRenderedRowsToMatchStore(page);

  expect(pageErrors).toEqual([]);
});

test('collapse-visible-folder updates the rendered window', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page);

  const beforeVisibleCount = await getCurrentVisibleCount(page);
  const prepared = await prepareAction(page, 'collapse-visible-folder');

  await page.locator('[data-action-id="collapse-visible-folder"]').click();

  await expectRenderedRowsToMatchStore(page);
  expect(await getCurrentVisibleCount(page)).toBeLessThan(beforeVisibleCount);
  expect(prepared.prepared.path).toEqual(expect.any(String));
  expect(pageErrors).toEqual([]);
});

test('rename-visible-folder updates the rendered window', async ({ page }) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page);

  const prepared = await prepareAction(page, 'rename-visible-folder');

  await page.locator('[data-action-id="rename-visible-folder"]').click();

  await expectRenderedRowsToMatchStore(page);
  await expect
    .poll(() => getRenderedRows(page))
    .toContain(prepared.prepared.to);
  expect(pageErrors).toEqual([]);
});

test('delete-visible-folder updates the rendered window', async ({ page }) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page);

  const prepared = await prepareAction(page, 'delete-visible-folder');
  const deletedPath = prepared.prepared.path;

  await page.locator('[data-action-id="delete-visible-folder"]').click();

  await expectRenderedRowsToMatchStore(page);
  await expect
    .poll(() =>
      page.evaluate(
        (path) => window.pathStoreDemo?.store.list(path).length ?? -1,
        deletedPath
      )
    )
    .toBe(0);
  expect(pageErrors).toEqual([]);
});

test('rename-visible-leaf updates the rendered window', async ({ page }) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page);

  const prepared = await prepareAction(page, 'rename-visible-leaf');

  await page.locator('[data-action-id="rename-visible-leaf"]').click();

  await expectRenderedRowsToMatchStore(page);
  await expect
    .poll(() => getRenderedRows(page))
    .toContain(prepared.prepared.to);
  expect(pageErrors).toEqual([]);
});

test('move-visible-folder-to-parent can be repeated without collisions surfacing', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page);

  for (let index = 0; index < 4; index++) {
    await page
      .locator('[data-action-id="move-visible-folder-to-parent"]')
      .click();
    await expectRenderedRowsToMatchStore(page);
  }

  expect(pageErrors).toEqual([]);
});

test('reset store restores the baseline window after mutations', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page);

  const baselineRows = await getRenderedRows(page);

  await page.locator('[data-action-id="rename-visible-leaf"]').click();
  await expectRenderedRowsToMatchStore(page);
  expect(await getRenderedRows(page)).not.toEqual(baselineRows);

  await page.locator('[data-action-id="reset"]').click();

  await expect.poll(() => getRenderedRows(page)).toEqual(baselineRows);
  await expectRenderedRowsToMatchStore(page);
  expect(pageErrors).toEqual([]);
});
