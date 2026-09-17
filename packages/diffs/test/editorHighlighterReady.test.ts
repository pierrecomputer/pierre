import { afterAll, expect, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
  registerCustomTheme,
} from '../src/highlighter';
import type { BaseCodeOptions, DiffsTheme } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';
import { createDeferred } from './testUtils';

afterAll(disposeHighlighter);

for (const type of ['file', 'file-diff'] as const) {
  test(`${type} waits for the current theme when an obsolete editor load finishes`, async () => {
    const options = {
      theme: 'pierre-dark',
      themeType: 'dark' as const,
      preferredHighlighter: 'shiki-js' as const,
      disableFileHeader: true,
    };
    await getSharedHighlighter({
      themes: [options.theme],
      preferredHighlighter: options.preferredHighlighter,
    });
    const obsoleteName = `editor-obsolete-${type}`;
    const currentName = `editor-current-${type}`;
    const obsolete = createDeferred<DiffsTheme>();
    const current = createDeferred<DiffsTheme>();
    registerCustomTheme(obsoleteName, () => obsolete.promise);
    registerCustomTheme(currentName, () => current.promise);
    const theme = {
      name: currentName,
      type: 'dark',
      colors: {
        'editor.foreground': '#123456',
        'editor.background': '#000000',
      },
    };
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const file = { name: 'ready.txt', lang: 'text', contents: 'ready\n' };
    const instance =
      type === 'file' ? new File(options) : new FileDiff(options);
    const editor =
      type === 'file' ? new Editor('file') : new Editor('file-diff');
    if (instance.type === 'file' && editor.type === 'file') {
      instance.render({ file, fileContainer });
      editor.edit(instance);
    } else if (instance.type === 'file-diff' && editor.type === 'file-diff') {
      instance.render({
        fileDiff: parseDiffFromFile({ ...file, contents: 'old\n' }, file),
        fileContainer,
      });
      editor.edit(instance);
    }
    await waitFor(() => editor.getText() === file.contents);
    let pendingTheme: BaseCodeOptions['theme'] = obsoleteName;
    // A pool can change effective themes while the existing editor DOM is reused.
    const effectiveOptions = spyOn(
      instance,
      '__getEffectiveCodeOptions'
    ).mockImplementation(() => ({ ...options, theme: pendingTheme }));
    const sync = spyOn(editor, '__syncRenderView');
    // Resume through the component so its asynchronous editor sync runs normally.
    const resume = () => {
      if (instance.type === 'file' && editor.type === 'file') {
        instance.__resumeEditor(editor);
      } else if (instance.type === 'file-diff' && editor.type === 'file-diff') {
        instance.__resumeEditor(editor);
      }
    };
    try {
      resume();
      pendingTheme = { dark: currentName, light: options.theme };
      resume();
      obsolete.resolve({ ...theme, name: obsoleteName });
      await getSharedHighlighter({
        themes: [obsoleteName],
        preferredHighlighter: options.preferredHighlighter,
      });
      await wait(0);
      expect(sync).not.toHaveBeenCalled();

      current.resolve(theme);
      await waitFor(() => sync.mock.calls.length > 0);
      expect(sync).toHaveBeenCalledTimes(1);
      expect(editor.getText()).toBe(file.contents);
    } finally {
      obsolete.resolve({ ...theme, name: obsoleteName });
      current.resolve(theme);
      editor.cleanUp();
      instance.cleanUp();
      await getSharedHighlighter({
        themes: [obsoleteName, currentName],
        preferredHighlighter: options.preferredHighlighter,
      });
      sync.mockRestore();
      effectiveOptions.mockRestore();
      dom.cleanup();
    }
  });
}
