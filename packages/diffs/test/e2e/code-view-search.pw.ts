import { expect, test } from '@playwright/test';

for (const kind of ['file', 'split', 'unified'] as const) {
  test(`replace all while recycled renders current text and undo in ${kind}`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/code-view-search.html?recycle&kind=${kind}&diffStyle=${kind}`
    );
    const root = page.locator('[data-code-view-root]');
    const content = root.locator('[contenteditable="true"]');
    await content
      .locator('[data-line="1"]:not([data-line-type="change-deletion"])')
      .click();
    await page.keyboard.press('ControlOrMeta+Alt+f');
    const panel = root.locator('[data-search-panel-overlay]');
    const search = panel.getByRole('textbox', { name: 'Search' });
    const replacement = panel.getByRole('textbox', {
      name: 'Replace',
      exact: true,
    });
    await expect(search).toBeVisible();
    await search.fill('target');
    await replacement.fill('NEW');
    await root.hover();
    await page.mouse.wheel(0, 6000);
    await expect(content).toHaveCount(0);
    await expect(replacement).toBeFocused();
    await panel
      .getByRole('button', { name: 'Replace All', exact: true })
      .click();
    await expect(panel.locator('[data-matches]')).toHaveText('No results');
    await expect
      .poll(() =>
        page.evaluate(() => window.__codeView?.getEditor('item')?.getText())
      )
      .toBe('NEW one\nkeep\nNEW two\n');
    await page.evaluate(() =>
      window.__codeView?.scrollTo({
        type: 'position',
        position: 0,
        behavior: 'instant',
      })
    );
    const rows = content.locator(
      '[data-line]:not([data-line-type="change-deletion"])'
    );
    await expect(rows.filter({ hasText: 'NEW' })).toHaveText([
      'NEW one',
      'NEW two',
    ]);
    await expect(content).not.toContainText('target');
    await expect(root.locator('[data-search-match]')).toHaveCount(0);
    await root.hover();
    await page.mouse.wheel(0, 6000);
    await expect(content).toHaveCount(0);
    await page.evaluate(() => window.__codeView?.getEditor('item')?.undo());
    await expect
      .poll(() =>
        page.evaluate(() => window.__codeView?.getEditor('item')?.canUndo)
      )
      .toBe(false);
    await page.evaluate(() =>
      window.__codeView?.scrollTo({
        type: 'position',
        position: 0,
        behavior: 'instant',
      })
    );
    await expect(rows.filter({ hasText: 'target' })).toHaveText([
      'target one',
      'target two',
    ]);
    await expect(panel.locator('[data-matches]')).toContainText('2');
    await expect(content.locator('[data-search-match]')).toHaveCount(2);
  });
}

test('ending edit mode with replacement input focused leaves find usable', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html?scope');
  const root = page.locator('[data-code-view-root]');
  await root.locator('[contenteditable="true"]').nth(1).click();
  await page.keyboard.press('ControlOrMeta+Alt+f');
  const panel = root.locator('[data-search-panel-overlay]');
  const search = panel.getByRole('textbox', { name: 'Search' });
  const replacement = panel.getByRole('textbox', {
    name: 'Replace',
    exact: true,
  });
  await search.fill('target');
  await replacement.fill('NEW');
  await expect(replacement).toBeFocused();
  await page.evaluate(() => {
    const view = window.__codeView!;
    view.updateItem({ ...view.getItem('second')!, edit: false, version: 1 });
  });
  await expect(replacement).toBeHidden();
  await expect(panel.locator('[data-matches]')).toContainText('5');
  await search.click();
  await expect(search).toBeFocused();
  await search.fill('readonly');
  await expect(panel.locator('[data-matches]')).toHaveText('1 of 1');
});

for (const diffStyle of ['split', 'unified'] as const) {
  test(`scoped search reveals and selects collapsed context in ${diffStyle} mode`, async ({
    page,
  }) => {
    await page.goto(
      `/test/e2e/fixtures/code-view-search.html?collapsed&diffStyle=${diffStyle}`
    );
    const root = page.locator('[data-code-view-root]');
    const content = root.locator('[contenteditable="true"]');
    const hiddenLine = content.locator(
      '[data-line="101"]:not([data-line-type="change-deletion"])'
    );
    await expect(hiddenLine).toHaveCount(0);
    await content
      .locator('[data-line="10"]:not([data-line-type="change-deletion"])')
      .click();
    await page.keyboard.press('ControlOrMeta+f');
    const input = root.getByRole('textbox', { name: 'Search' });
    await input.fill('target');
    await expect(root.locator('[data-matches]')).toHaveText('1 of 1');
    await expect(hiddenLine).toBeInViewport();
    await expect(input).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__codeView?.getEditor('diff')?.getViewState().selections
        )
      )
      .toEqual([
        {
          start: { line: 100, character: 7 },
          end: { line: 100, character: 13 },
          direction: 1,
        },
      ]);
    await expect(content.locator('[data-line="210"]')).toHaveCount(0);
    await input.press('Enter');
    await expect(hiddenLine).toBeInViewport();
    await expect(input).toBeFocused();

    const replacement = root.getByRole('textbox', {
      name: 'Replace',
      exact: true,
    });
    await replacement.fill('changed');
    await replacement.press('Enter');
    await expect(hiddenLine).toContainText('hidden changed');
    await expect(root.locator('[data-matches]')).toHaveText('No results');
    await expect(replacement).toBeFocused();
    await page.evaluate(() => window.__codeView?.getEditor('diff')?.undo());
    await expect(hiddenLine).toContainText('hidden target');
    await expect(root.locator('[data-matches]')).toContainText('1');
  });
}

test('search scope follows focus across editors, the panel, and outside CodeView', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html?scope');
  const root = page.locator('[data-code-view-root]');
  const editors = root.locator('[contenteditable="true"]');
  const first = editors.nth(0);
  const second = editors.nth(1);
  await first.click();
  await expect(root.locator('[data-search-panel]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+f');
  const panel = root.locator('[data-search-panel-overlay]');
  const input = panel.getByRole('textbox', { name: 'Search' });
  const count = panel.locator('[data-matches]');
  const replacement = panel.getByRole('textbox', {
    name: 'Replace',
    exact: true,
  });
  await expect(replacement).toBeVisible();
  await replacement.fill('changed');
  await input.fill('target');
  await expect(count).toHaveText('1 of 1');
  await expect(
    root.locator('[data-deletions] [data-search-match]')
  ).toHaveCount(0);

  await second.click();
  await expect(count).toHaveText('2 results');
  await expect(second).toBeFocused();
  await expect(replacement).toHaveValue('changed');
  const matchCase = panel.getByRole('button', { name: 'Match Case' });
  await matchCase.click();
  await expect(matchCase).toHaveAttribute('aria-pressed', 'true');
  await expect(count).toContainText('of 2');
  await input.click();
  await page.keyboard.press('ControlOrMeta+f');
  await input.press('Enter');
  await expect(count).toContainText('of 2');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('target');

  await page.locator('[data-outside]').click();
  await expect(count).toContainText('of 5');
  await expect(
    root.locator('[data-deletions] [data-search-match]')
  ).toHaveCount(1);
  await expect(page.locator('[data-outside]')).toBeFocused();
  await expect(replacement).toBeHidden();
  await expect(matchCase).toHaveAttribute('aria-pressed', 'true');
  await first.click();
  await expect(count).toHaveText('1 results');
  await expect(
    root.locator('[data-deletions] [data-search-match]')
  ).toHaveCount(0);
  await expect(first).toBeFocused();
  await expect(replacement).toBeVisible();
  await expect(replacement).toHaveValue('changed');

  await root.focus();
  await page.keyboard.press('ControlOrMeta+f');
  await expect(count).toHaveText('5 results');
  await expect(replacement).toBeHidden();
  await expect(input).toHaveValue('target');
  await expect(root.getByRole('textbox', { name: 'Search' })).toHaveCount(1);
  await input.press('Escape');
  await first.click();
  await expect(root.locator('[data-search-panel]')).toHaveCount(0);
});

test('scoped replacement advances past inserted matches and replace all is one undo step', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html?scope');
  const root = page.locator('[data-code-view-root]');
  const content = root.locator('[contenteditable="true"]').nth(1);
  await expect(content).toBeVisible();
  await page.evaluate(() =>
    window.__codeView?.getEditor('second')?.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 13 },
        },
        newText: 'target target target',
      },
    ])
  );
  await expect(content).toContainText('target target target');
  await content.click();
  await page.keyboard.press('ControlOrMeta+Alt+f');
  const panel = root.locator('[data-search-panel-overlay]');
  const input = panel.getByRole('textbox', { name: 'Search' });
  const replacement = panel.getByRole('textbox', {
    name: 'Replace',
    exact: true,
  });
  const count = panel.locator('[data-matches]');
  await input.fill('target');
  await input.press('Enter');
  await expect(count).toHaveText('2 of 3');
  await replacement.fill('targettarget');
  await replacement.press('Enter');
  await expect(content).toContainText('target targettarget target');
  await expect(count).toHaveText('4 of 4');
  await expect(replacement).toBeFocused();
  await replacement.press('Enter');
  await expect(content).toContainText('target targettarget targettarget');
  await expect(count).toHaveText('5 results');
  await replacement.fill('new');
  await panel.getByRole('button', { name: 'Replace All', exact: true }).click();
  await expect(content).toContainText('new newnew newnew');
  await expect(count).toHaveText('No results');
  await expect(root.locator('[data-search-match]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => window.__codeView?.getEditor('diff')?.getText())
    )
    .toBe('target added\nunchanged\n');
  await page.evaluate(() => window.__codeView?.getEditor('second')?.undo());
  await expect(content).toContainText('target targettarget targettarget');
  await expect(count).toContainText('5');
  await expect(content.locator('[data-search-match]')).toHaveCount(5);
});

test('refreshes search after typing and undo without a host update', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html');
  const root = page.locator('[data-code-view-root]');
  const content = root.locator('[contenteditable="true"]');
  await content.click();
  await page.keyboard.press('ControlOrMeta+f');
  const panel = root.locator('[data-search-panel-overlay]');
  await panel.getByRole('textbox', { name: 'Search' }).fill('github');
  await expect(panel.locator('[data-matches]')).toHaveText('1 of 4');

  const line = content.locator('[data-line="125"]');
  await line.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('github ');
  await expect(panel.locator('[data-matches]')).toContainText('5');
  await expect(line.locator('[data-search-match]')).toHaveCount(2);
  await expect(content).toBeFocused();

  await page.keyboard.press('ControlOrMeta+z');
  await expect(panel.locator('[data-matches]')).toContainText('4');
  await expect(line.locator('[data-search-match]')).toHaveCount(1);
});

test('find from an editable CodeView uses its panel and reaches offscreen matches', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/code-view-search.html');
  const root = page.locator('[data-code-view-root]');
  const content = root.locator('[contenteditable="true"]');
  await content.click();
  await page.keyboard.press('ControlOrMeta+f');

  const panel = root.locator('[data-search-panel-overlay]');
  const input = panel.getByRole('textbox', { name: 'Search' });
  await expect(input).toBeFocused();
  await expect(root.getByRole('textbox', { name: 'Search' })).toHaveCount(1);
  await input.fill('github');
  await expect(panel.locator('[data-matches]')).toHaveText('1 of 4');
  for (let match = 2; match <= 4; match++) {
    await input.press('Enter');
    await expect(panel.locator('[data-matches]')).toHaveText(`${match} of 4`);
  }

  const line201 = content.locator('[data-line="201"]');
  await expect(line201).toBeInViewport();
  await expect(input).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__codeView?.getEditor('file')?.getViewState().selections
      )
    )
    .toEqual([
      {
        start: { line: 200, character: 0 },
        end: { line: 200, character: 6 },
        direction: 1,
      },
    ]);

  // Returning focus to an editor must keep find-again on the CodeView panel.
  await line201.click();
  await page.keyboard.press('ControlOrMeta+Shift+g');
  await expect(panel.locator('[data-matches]')).toHaveText('3 of 4');
  await expect(content.locator('[data-line="128"]')).toBeInViewport();
  await page.keyboard.press('ControlOrMeta+g');
  await expect(panel.locator('[data-matches]')).toHaveText('4 of 4');
  await expect(line201).toBeInViewport();

  // User scrolling must remain usable after visiting the offscreen match.
  await root.hover();
  await page.mouse.wheel(0, 2000);
  await expect(line201).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(input).toBeFocused();
  await input.press('Enter');
  await expect(panel.locator('[data-matches]')).toHaveText('1 of 4');
  await expect(content.locator('[data-line="125"]')).toBeInViewport();

  await content.locator('[data-line="125"]').click();
  await page.keyboard.press('Escape');
  await expect(root.locator('[data-search-panel]')).toHaveCount(0);
  await page.keyboard.type('typed');
  await expect(content).toContainText('typed');
});
