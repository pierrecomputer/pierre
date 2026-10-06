import { expect, test } from '@playwright/test';

for (const backend of ['highlights', 'shiki-js', 'shiki-wasm'] as const) {
  test(`${backend} applies token fonts when the theme changes`, async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/index.html');
    await page.evaluate(async (preferredHighlighter) => {
      const url = '/dist/index.js';
      const { File, getSharedHighlighter, registerCustomTheme } = (await import(
        url
      )) as typeof import('../../src');
      for (const type of ['light', 'dark'] as const) {
        const name = `token-font-${type}`;
        registerCustomTheme(name, () =>
          Promise.resolve({
            name,
            type,
            colors: {
              'editor.foreground': '#333333',
              'editor.background': '#ffffff',
            },
            tokenColors: [
              {
                scope: 'markup.italic',
                settings: {
                  foreground: '#ff0000',
                  fontStyle: type === 'light' ? 'italic' : '',
                },
              },
              {
                scope: 'markup.bold',
                settings: {
                  foreground: '#0000ff',
                  fontStyle: type === 'light' ? 'bold' : 'italic',
                },
              },
            ],
          })
        );
        registerCustomTheme(
          name,
          () =>
            Promise.resolve({
              name,
              appearance: type,
              style: {
                'editor.foreground': '#333333',
                'editor.background': '#ffffff',
                syntax: {
                  emphasis: {
                    color: '#ff0000',
                    font_style: type === 'light' ? 'italic' : 'normal',
                  },
                  'emphasis.strong': {
                    color: '#0000ff',
                    font_style: type === 'light' ? 'normal' : 'italic',
                    font_weight: type === 'light' ? 700 : 400,
                  },
                },
              },
            }),
          'zed'
        );
      }
      await getSharedHighlighter({
        preferredHighlighter,
        themes: ['token-font-light', 'token-font-dark'],
        langs: ['markdown'],
      });
      document.body.replaceChildren();
      for (const mode of ['dual', 'single']) {
        const mount = document.createElement('div');
        mount.id = mode;
        document.body.append(mount);
        const file = new File({
          preferredHighlighter,
          theme:
            mode === 'single'
              ? 'token-font-light'
              : { light: 'token-font-light', dark: 'token-font-dark' },
          themeType: 'system',
          disableFileHeader: true,
        });
        file.render({
          file: { name: 'fonts.md', contents: '*italic* **bold** plain\n' },
          containerWrapper: mount,
        });
        for (const type of ['light', 'dark', 'system'] as const) {
          const button = document.createElement('button');
          button.id = `${mode}-${type}`;
          button.textContent = type;
          button.addEventListener('click', () => file.setThemeType(type));
          document.body.append(button);
        }
      }
    }, backend);

    const dual = page.locator('#dual [data-line="1"] span');
    const italic = dual.filter({ hasText: '*italic*' });
    const bold = dual.filter({ hasText: '**bold**' });
    const single = page.locator('#single [data-line="1"] span');
    await expect(italic).toHaveCount(1);
    await expect(bold).toHaveCount(1);

    await page.locator('#dual diffs-container').evaluate((host) => {
      const prediction = document.createElement('span');
      prediction.setAttribute('data-edit-prediction-suffix', '');
      const token = document.createElement('span');
      token.textContent = 'prediction';
      token.style.cssText =
        '--diffs-token-light-font-style:italic;' +
        '--diffs-token-light-font-weight:600;' +
        '--diffs-token-light-text-decoration:underline;' +
        '--diffs-token-dark-font-weight:900;' +
        '--diffs-token-dark-text-decoration:line-through;';
      prediction.append(token);
      host.shadowRoot?.append(prediction);
    });
    const prediction = page.locator('[data-edit-prediction-suffix] span');

    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const type of ['system', 'light', 'dark', 'system'] as const) {
        await page.locator(`#dual-${type}`).click();
        await page.locator(`#single-${type}`).click();
        const light = (type === 'system' ? scheme : type) === 'light';
        await expect(italic).toHaveCSS(
          'font-style',
          light ? 'italic' : 'normal'
        );
        await expect(bold).toHaveCSS('font-weight', light ? '700' : '400');
        await expect(bold).toHaveCSS('font-style', light ? 'normal' : 'italic');
        await expect(single.filter({ hasText: '*italic*' })).toHaveCSS(
          'font-style',
          'italic'
        );
        await expect(single.filter({ hasText: '**bold**' })).toHaveCSS(
          'font-weight',
          '700'
        );
        await expect(prediction).toHaveCSS(
          'font-style',
          light ? 'italic' : 'normal'
        );
        await expect(prediction).toHaveCSS(
          'font-weight',
          light ? '600' : '900'
        );
        await expect(prediction).toHaveCSS(
          'text-decoration-line',
          light ? 'underline' : 'line-through'
        );
      }
    }
  });
}
