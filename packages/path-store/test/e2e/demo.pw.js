import { expect, test } from '@playwright/test';

const demoSmallVisibleRows = [
  'alpha/',
  'alpha/docs/',
  'alpha/docs/readme.md',
  'alpha/src/',
  'alpha/src/utils/',
  'alpha/src/utils/math.ts',
  'alpha/src/app.ts',
  'alpha/todo.txt',
  'beta/',
  'beta/archive/',
  'beta/archive/notes.txt',
  'beta/keep.txt',
  'gamma/',
  'gamma/logs/',
  'gamma/logs/today.txt',
  'zeta.md',
];

/**
 * @typedef {import('@playwright/test').Locator} Locator
 * @typedef {import('@playwright/test').Page} Page
 */

/**
 * @typedef {Record<string, unknown>} DemoPreparedAction
 */

/**
 * @param {Page} page
 * @returns {Locator}
 */
function getRowsLocator(page) {
  return page.locator('#rows');
}

/**
 * @param {Page} page
 * @returns {Promise<string[]>}
 */
async function getRenderedRows(page) {
  const text = await getRowsLocator(page).innerText();
  return text === '' ? [] : text.split('\n');
}

/**
 * @param {Page} page
 * @param {readonly string[]} expectedRows
 * @returns {Promise<void>}
 */
async function expectRenderedRows(page, expectedRows) {
  await expect.poll(() => getRenderedRows(page)).toEqual(expectedRows);
}

/**
 * @param {Page} page
 * @param {string} [workload]
 * @returns {Promise<void>}
 */
async function renderDemo(page, workload = 'linux') {
  await page.goto('/');
  await expect(getRowsLocator(page)).toHaveText('');
  await expect(page.locator('#offset')).toBeDisabled();

  await page.locator('#workload').selectOption(workload);
  await page.getByRole('button', { name: 'Render' }).click();

  await expect
    .poll(() => getRenderedRows(page).then((rows) => rows.length))
    .toBeGreaterThan(0);
  await expect(page.locator('#offset')).toBeEnabled();
}

/**
 * @param {Page} page
 * @param {number} value
 * @returns {Promise<void>}
 */
async function setVisibleCount(page, value) {
  await page.locator('#visible-count').fill(String(value));
}

/**
 * @param {Page} page
 * @param {number} value
 * @returns {Promise<void>}
 */
async function setOffset(page, value) {
  await page.locator('#offset').evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('Offset control is not an input.');
    }

    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/**
 * @param {Page} page
 * @returns {Error[]}
 */
function trackPageErrors(page) {
  /** @type {Error[]} */
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error);
  });
  return pageErrors;
}

/**
 * @param {number} start
 * @param {number} count
 * @param {readonly string[]} [rows]
 * @returns {string[]}
 */
function getWindowRows(start, count, rows = demoSmallVisibleRows) {
  return rows.slice(start, start + count);
}

test('demo-small renders exact rows at different offsets', async ({ page }) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);

  await expectRenderedRows(page, getWindowRows(0, 4));

  await setOffset(page, 4);
  await expect(page.locator('#offset-value')).toHaveText('4');
  await expectRenderedRows(page, getWindowRows(4, 4));

  await setOffset(page, 11);
  await expect(page.locator('#offset-value')).toHaveText('11');
  await expectRenderedRows(page, getWindowRows(11, 4));

  expect(pageErrors).toEqual([]);
});

test('demo-small collapse-visible-folder collapses the first visible folder without jumping oddly', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);
  await expectRenderedRows(page, getWindowRows(0, 4));

  await page.locator('[data-action-id="collapse-visible-folder"]').click();

  await expectRenderedRows(page, [
    'alpha/',
    'beta/',
    'beta/archive/',
    'beta/archive/notes.txt',
  ]);
  expect(pageErrors).toEqual([]);
});

test('demo-small expand-visible-folder restores the collapsed rows in place', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);
  await page.locator('[data-action-id="collapse-visible-folder"]').click();
  await expectRenderedRows(page, [
    'alpha/',
    'beta/',
    'beta/archive/',
    'beta/archive/notes.txt',
  ]);

  await page.locator('[data-action-id="expand-visible-folder"]').click();

  await expectRenderedRows(page, getWindowRows(0, 4));
  expect(pageErrors).toEqual([]);
});

test('demo-small profile prepare can expand a folder from the default fully-expanded state', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);

  /** @type {DemoPreparedAction} */
  const prepared = await page.evaluate(() => {
    return /** @type {DemoPreparedAction} */ (
      window.pathStoreDemo.prepareProfileAction('expand-visible-folder')
    );
  });

  await expectRenderedRows(page, [
    'alpha/',
    'beta/',
    'beta/archive/',
    'beta/archive/notes.txt',
  ]);

  await page.evaluate((nextPrepared) => {
    return /** @type {Promise<unknown>} */ (
      window.pathStoreDemo.profilePreparedAction(
        'expand-visible-folder',
        nextPrepared
      )
    );
  }, prepared);

  await expectRenderedRows(page, getWindowRows(0, 4));
  expect(pageErrors).toEqual([]);
});

test('demo-small rename-visible-folder renames the first visible folder and its descendants in place', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);
  await expectRenderedRows(page, getWindowRows(0, 4));

  await page.locator('[data-action-id="rename-visible-folder"]').click();

  await expectRenderedRows(page, [
    'alpha-demo-renamed/',
    'alpha-demo-renamed/docs/',
    'alpha-demo-renamed/docs/readme.md',
    'alpha-demo-renamed/src/',
  ]);
  expect(pageErrors).toEqual([]);
});

test('demo-small delete-visible-folder removes the first visible folder subtree', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);
  await expectRenderedRows(page, getWindowRows(0, 4));

  await page.locator('[data-action-id="delete-visible-folder"]').click();

  await expectRenderedRows(page, [
    'beta/',
    'beta/archive/',
    'beta/archive/notes.txt',
    'beta/keep.txt',
  ]);
  expect(pageErrors).toEqual([]);
});

test('demo-small delete-visible-leaf removes the first visible file in the current window', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);
  await setOffset(page, 2);
  await expectRenderedRows(page, getWindowRows(2, 4));

  await page.locator('[data-action-id="delete-visible-leaf"]').click();

  await expectRenderedRows(page, [
    'alpha/src/',
    'alpha/src/utils/',
    'alpha/src/utils/math.ts',
    'alpha/src/app.ts',
  ]);
  expect(pageErrors).toEqual([]);
});

test('demo-small rename-visible-leaf renames the first visible file in the current window', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);
  await setOffset(page, 2);
  await expectRenderedRows(page, getWindowRows(2, 4));

  await page.locator('[data-action-id="rename-visible-leaf"]').click();

  await expectRenderedRows(page, [
    'alpha/docs/readme-demo-renamed.md',
    'alpha/src/',
    'alpha/src/utils/',
    'alpha/src/utils/math.ts',
  ]);
  expect(pageErrors).toEqual([]);
});

test('demo-small move-visible-leaf-to-parent reveals the moved file in the adjusted window', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);
  await setOffset(page, 2);
  await expectRenderedRows(page, getWindowRows(2, 4));

  await page.locator('[data-action-id="move-visible-leaf-to-parent"]').click();

  await expectRenderedRows(page, [
    'alpha/src/utils/',
    'alpha/src/utils/math.ts',
    'alpha/src/app.ts',
    'alpha/readme.md',
  ]);
  expect(pageErrors).toEqual([]);
});

test('demo-small move-visible-folder-to-parent reveals the moved folder at the same offset window', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);
  await setOffset(page, 3);
  await expectRenderedRows(page, getWindowRows(3, 4));

  await page
    .locator('[data-action-id="move-visible-folder-to-parent"]')
    .click();

  await expectRenderedRows(page, [
    'alpha/src/',
    'alpha/src/app.ts',
    'alpha/utils/',
    'alpha/utils/math.ts',
  ]);
  expect(pageErrors).toEqual([]);
});

test('demo-small collapse-folder-above-viewport shifts the fixed offset window', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);
  await setOffset(page, 8);
  await expectRenderedRows(page, getWindowRows(8, 4));

  await page
    .locator('[data-action-id="collapse-folder-above-viewport"]')
    .click();

  await expectRenderedRows(page, [
    'beta/archive/',
    'beta/archive/notes.txt',
    'beta/keep.txt',
    'gamma/',
  ]);
  expect(pageErrors).toEqual([]);
});

test('demo-small profile prepare can collapse a folder above the viewport from offset zero', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);

  /** @type {DemoPreparedAction} */
  const prepared = await page.evaluate(() => {
    return /** @type {DemoPreparedAction} */ (
      window.pathStoreDemo.prepareProfileAction(
        'collapse-folder-above-viewport'
      )
    );
  });

  await expect(page.locator('#offset-value')).toHaveText('4');
  await expectRenderedRows(page, getWindowRows(4, 4));

  await page.evaluate((nextPrepared) => {
    return /** @type {Promise<unknown>} */ (
      window.pathStoreDemo.profilePreparedAction(
        'collapse-folder-above-viewport',
        nextPrepared
      )
    );
  }, prepared);

  await expectRenderedRows(page, [
    'alpha/todo.txt',
    'beta/',
    'beta/archive/',
    'beta/archive/notes.txt',
  ]);
  expect(pageErrors).toEqual([]);
});

test('demo-small reset restores the exact baseline window after a mutation', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'demo-small');
  await setVisibleCount(page, 4);
  const baselineRows = getWindowRows(0, 4);

  await expectRenderedRows(page, baselineRows);
  await page.locator('[data-action-id="rename-visible-leaf"]').click();
  await expectRenderedRows(page, [
    'alpha/',
    'alpha/docs/',
    'alpha/docs/readme-demo-renamed.md',
    'alpha/src/',
  ]);

  await page.locator('[data-action-id="reset"]').click();

  await expectRenderedRows(page, baselineRows);
  expect(pageErrors).toEqual([]);
});

test('linux move-visible-folder-to-parent can be repeated without surfacing collisions', async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await renderDemo(page, 'linux');
  await setVisibleCount(page, 30);

  for (let index = 0; index < 4; index++) {
    await page
      .locator('[data-action-id="move-visible-folder-to-parent"]')
      .click();
    await expect
      .poll(() => getRenderedRows(page).then((rows) => rows.length))
      .toBe(30);
  }

  expect(pageErrors).toEqual([]);
});
