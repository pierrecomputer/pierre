import { afterAll, expect, spyOn, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { registerCustomTheme } from '../src/highlighter/themes/registerCustomTheme';
import type { ThemeRegistration } from '../src/types';
import { createRoot, installDom, wait, waitFor } from './domHarness';
import { createDeferred } from './testUtils';

afterAll(disposeHighlighter);

for (const obsoleteFinishesFirst of [false, true]) {
  test(`switches pending themes when the ${obsoleteFinishesFirst ? 'obsolete' : 'current'} loader finishes first`, async () => {
    const obsoleteName = `codeview-obsolete-${obsoleteFinishesFirst}`;
    const currentName = `codeview-current-${obsoleteFinishesFirst}`;
    const obsoleteTheme: ThemeRegistration = {
      name: obsoleteName,
      type: 'dark',
      colors: {},
      tokenColors: [],
    };
    const currentTheme: ThemeRegistration = {
      ...obsoleteTheme,
      name: currentName,
    };
    const obsolete = createDeferred<ThemeRegistration>();
    const current = createDeferred<ThemeRegistration>();
    const started: string[] = [];
    registerCustomTheme(obsoleteName, () => {
      started.push(obsoleteName);
      return obsolete.promise;
    });
    registerCustomTheme(currentName, () => {
      started.push(currentName);
      return current.promise;
    });

    const dom = installDom();
    const viewer = new CodeView({ theme: obsoleteName });
    const render = spyOn(viewer, 'render');
    try {
      viewer.setup(createRoot());
      viewer.setItems([
        {
          id: 'file',
          type: 'file',
          file: { name: 'ready.txt', lang: 'text', contents: 'ready\n' },
        },
      ]);
      viewer.render(true);
      await waitFor(() => started.includes(obsoleteName));
      expect(started).toEqual([obsoleteName]);
      expect(viewer.getRenderedItems()).toHaveLength(0);

      viewer.setOptions({ theme: currentName });
      viewer.render(true);
      await waitFor(() => started.includes(currentName));
      expect(started).toEqual([obsoleteName, currentName]);
      expect(viewer.getRenderedItems()).toHaveLength(0);

      if (obsoleteFinishesFirst) {
        await wait(0);
        render.mockClear();
        obsolete.resolve(obsoleteTheme);
        await getSharedHighlighter({ themes: [obsoleteName], langs: [] });
        await wait(0);
        expect(render).not.toHaveBeenCalled();
        expect(viewer.getRenderedItems()).toHaveLength(0);
      }

      current.resolve(currentTheme);
      await waitFor(() => viewer.getRenderedItems().length === 1);
      expect(
        viewer.getRenderedItems()[0]?.element.shadowRoot?.textContent
      ).toContain('ready');

      if (!obsoleteFinishesFirst) {
        await wait(0);
        render.mockClear();
        obsolete.resolve(obsoleteTheme);
        await getSharedHighlighter({ themes: [obsoleteName], langs: [] });
        await wait(0);
        expect(render).not.toHaveBeenCalled();
      }
    } finally {
      viewer.cleanUp();
      obsolete.resolve(obsoleteTheme);
      current.resolve(currentTheme);
      await getSharedHighlighter({
        themes: [obsoleteName, currentName],
        langs: [],
      });
      render.mockRestore();
      dom.cleanup();
    }
  });
}
