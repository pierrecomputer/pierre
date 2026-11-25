import { expect, type Page, test } from '@playwright/test';

const CONTENT = '[data-content]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/editable.html');
  await page.waitForFunction(() => window.__editableReady === true);
}

const contents = (page: Page): Promise<string> =>
  page.evaluate(() => window.__editor?.getText() ?? '');
const changeCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__editorEvents?.length ?? 0);

test.describe('rewrite the whole editable file', () => {
  test('selecting all, deleting, and typing new code emits the new file', async ({
    page,
  }) => {
    await openFixture(page);

    // Select everything and clear it.
    await page.locator(CONTENT).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect.poll(() => contents(page)).toBe('');

    // Type a fresh multi-line file (Enter for the line break).
    await page.keyboard.type('const rewritten = true;');
    await page.keyboard.press('Enter');
    await page.keyboard.type('export default rewritten;');

    await expect
      .poll(() => contents(page))
      .toBe('const rewritten = true;\nexport default rewritten;');
    // None of the original content survives the rewrite.
    await expect.poll(() => contents(page)).not.toContain('foo');
    await expect.poll(() => changeCount(page)).toBeGreaterThan(0);
  });
});

// Deliver the browser notification after the editor's deferred focus and its
// following release frame, so the result is independent of typing speed.
async function notifyAfterFocus(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
    );
    document.dispatchEvent(new Event('selectionchange'));
  });
}

for (const selectAll of [true, false]) {
  test(`typing over wrapped text preserves the ${selectAll ? 'whole-file' : 'word'} selection`, async ({
    page,
  }) => {
    await openFixture(page);
    const content = page.locator(CONTENT);
    const original = await contents(page);
    if (selectAll) {
      await content.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('abc');
      await page.keyboard.press('ControlOrMeta+a');
    } else {
      await content.getByText('foo', { exact: true }).first().dblclick();
    }
    await page.keyboard.type('{');
    await notifyAfterFocus(page);
    const start = selectAll ? 1 : 7;
    expect(
      await page.evaluate(() => window.__editor?.getViewState().selections)
    ).toMatchObject([
      {
        start: { line: 0, character: start },
        end: { line: 0, character: start + 3 },
      },
    ]);
    await page.keyboard.type('x');
    expect(await contents(page)).toBe(
      selectAll ? '{x}' : original.replace('foo', '{x}')
    );
  });
}

test('a clipped Select All survives a keydown before the replacement', async ({
  page,
}) => {
  await page.goto('/test/e2e/fixtures/editable.html?windowed');
  await page.waitForFunction(() => window.__editableReady === true);
  await page.locator(CONTENT).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Shift');
  await notifyAfterFocus(page);
  await page.keyboard.press('Backspace');
  expect(await contents(page)).toBe('');
});

test('refocus preserves a backward range and a click takes over from it', async ({
  page,
}) => {
  await openFixture(page);
  const original = await contents(page);
  await page.evaluate(() => {
    const editor = window.__editor!;
    editor.setSelections([
      {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 9 },
        direction: 'backward',
      },
    ]);
    editor.focus();
  });
  await notifyAfterFocus(page);
  // Shift+Left extends from the left end of a backward selection.
  await page.keyboard.press('Shift+ArrowLeft');
  expect(
    await page.evaluate(() => window.__editor?.getViewState().selections)
  ).toMatchObject([
    { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } },
  ]);
  await page.keyboard.type('{');
  const content = page.locator(CONTENT);
  await content.getByText('bar', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('x');
  expect(await contents(page)).toBe(
    original.replace(' foo', '{ foo}').replace('foo + foo;', 'foo + foo;x')
  );
});

for (const multiline of [false, true]) {
  test(`canceling and retrying an IME replacement over a ${multiline ? 'multiline' : 'word'} selection`, async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Real IME input uses the Chromium DevTools protocol.'
    );
    await openFixture(page);
    const content = page.locator(CONTENT);
    const original = await contents(page);
    if (multiline) {
      await content.click();
      await page.keyboard.press('ControlOrMeta+a');
    } else {
      await content.getByText('foo', { exact: true }).first().dblclick();
    }
    const selection = () =>
      page.evaluate(() => window.__editor?.getViewState().selections);
    const before = await selection();
    const rows = content.locator(':scope > [data-line]');
    const rendered = await rows.allTextContents();
    const client = await page.context().newCDPSession(page);
    const compose = (text: string) =>
      client.send('Input.imeSetComposition', {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      });

    await compose('仮');
    await compose('');
    await notifyAfterFocus(page);
    expect(await rows.allTextContents()).toEqual(rendered);
    expect(await contents(page)).toBe(original);
    expect(await changeCount(page)).toBe(0);
    expect(await selection()).toEqual(before);

    await compose('か');
    await client.send('Input.insertText', { text: '仮' });
    const replaced = multiline ? '仮' : original.replace('foo', '仮');
    expect(await contents(page)).toBe(replaced);
    expect(await changeCount(page)).toBe(1);
    await page.keyboard.type('x');
    expect(await contents(page)).toBe(replaced.replace('仮', '仮x'));
  });
}
