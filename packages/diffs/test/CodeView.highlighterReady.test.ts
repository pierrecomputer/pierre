import type { Theme } from '@pierre/highlights';
import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import type { ThemeRegistration } from 'shiki';

import { CodeView } from '../src/components/CodeView';
import {
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { registerCustomTheme } from '../src/highlighter/themes/registerCustomTheme';
import { customThemes } from '../src/highlighter/themes/themeResolver';
import { WorkerPoolManager } from '../src/worker/WorkerPoolManager';
import {
  createRoot,
  installDom,
  makeFileItem,
  wait,
  waitFor,
} from './domHarness';
import { createDeferred, getRejection } from './testUtils';
import {
  createInitializingManager,
  TestWorker,
  withTimeout,
} from './workerPoolHarness';

beforeEach(disposeHighlighter);
afterAll(disposeHighlighter);

function firstRowText<LAnnotation, Caret>(
  viewer: CodeView<LAnnotation, Caret>
): string | null | undefined {
  return viewer
    .getRenderedItems()[0]
    ?.element.shadowRoot?.querySelector('[data-line="1"]')?.textContent;
}

test('retries a failed theme load on a later render without automatically retrying', async () => {
  const theme = {
    name: 'codeview-retry-theme',
    appearance: 'dark',
    style: {},
  } satisfies Theme;
  const firstLoad = createDeferred<Theme>();
  const loader = mock(() => firstLoad.promise);
  registerCustomTheme(theme.name, loader, 'zed');
  const error = new Error('Theme chunk failed to load');
  const logError = spyOn(console, 'error').mockImplementation(() => {});
  const dom = installDom();
  const viewer = new CodeView({
    theme: theme.name,
    preferredHighlighter: 'highlights',
  });
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
    await waitFor(() => loader.mock.calls.length === 1);
    await wait(0);
    render.mockClear();

    firstLoad.reject(error);
    await waitFor(() => logError.mock.calls.length > 0);
    await wait(0);
    expect(logError).toHaveBeenCalledWith(error);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
    expect(viewer.getRenderedItems()).toHaveLength(0);

    loader.mockImplementation(() => Promise.resolve(theme));
    viewer.render(true);
    await waitFor(() => viewer.getRenderedItems().length === 1);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(
      viewer.getRenderedItems()[0]?.element.shadowRoot?.textContent
    ).toContain('ready');
  } finally {
    viewer.cleanUp();
    firstLoad.resolve(theme);
    render.mockRestore();
    logError.mockRestore();
    dom.cleanup();
  }
});

for (const obsoleteFinishesFirst of [false, true]) {
  test(`switches pending themes when the ${obsoleteFinishesFirst ? 'obsolete' : 'current'} loader finishes first`, async () => {
    const obsoleteName = `codeview-obsolete-${obsoleteFinishesFirst}`;
    const currentName = `codeview-current-${obsoleteFinishesFirst}`;
    const obsoleteTheme: Theme = {
      name: obsoleteName,
      appearance: 'dark',
      style: {},
    };
    const currentTheme: Theme = {
      ...obsoleteTheme,
      name: currentName,
    };
    const obsolete = createDeferred<Theme>();
    const current = createDeferred<Theme>();
    const started: string[] = [];
    registerCustomTheme(
      obsoleteName,
      () => {
        started.push(obsoleteName);
        return obsolete.promise;
      },
      'zed'
    );
    registerCustomTheme(
      currentName,
      () => {
        started.push(currentName);
        return current.promise;
      },
      'zed'
    );

    const dom = installDom();
    const viewer = new CodeView({
      theme: obsoleteName,
      preferredHighlighter: 'highlights',
    });
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

      viewer.setOptions({
        theme: currentName,
        preferredHighlighter: 'highlights',
      });
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

test('a pool-backed view paints when the host retries a failed theme, before any worker is ready', async () => {
  const theme = 'codeview-pool-retried-theme';
  const registration: ThemeRegistration = {
    name: theme,
    type: 'dark',
    colors: {},
    tokenColors: [],
  };
  const firstLoad = createDeferred<ThemeRegistration>();
  let loads = 0;
  registerCustomTheme(theme, () =>
    ++loads === 1 ? firstLoad.promise : Promise.resolve(registration)
  );
  const report = spyOn(console, 'error').mockImplementation(() => {});
  const dom = installDom();
  const { manager, initialization, worker } = createInitializingManager({
    theme,
    preferredHighlighter: 'shiki-js',
  });
  const viewer = new CodeView({ disableFileHeader: true }, manager);
  try {
    await waitFor(() => loads === 1 && getHighlighterIfLoaded() != null);
    viewer.setup(createRoot());
    viewer.setItems([
      {
        id: 'file',
        type: 'file',
        file: { name: 'ready.txt', lang: 'text', contents: 'ready\n' },
      },
    ]);
    viewer.render(true);
    await wait(0);
    expect(loads).toBe(1);

    const error = new Error('theme unavailable');
    firstLoad.reject(error);
    expect(await getRejection(initialization)).toBe(error);
    await wait(0);
    expect(loads).toBe(1);
    expect(viewer.getRenderedItems()).toHaveLength(0);

    // The worker's initialize reply is never sent.
    void manager.initialize().catch(() => {});
    await waitFor(() => firstRowText(viewer) === 'ready');
    expect(firstRowText(viewer)).toBe('ready');
    expect(loads).toBe(2);
    await withTimeout(worker.waitForInitializeRequest());
    expect(manager.getStats()).toMatchObject({
      managerState: 'initializing',
      readyWorkers: 0,
    });
  } finally {
    firstLoad.resolve(registration);
    void initialization.catch(() => {});
    viewer.cleanUp();
    manager.terminate();
    report.mockRestore();
    customThemes.delete(theme);
    dom.cleanup();
  }
});

test('a pool terminated after an empty mount restarts for the next visible item', async () => {
  const dom = installDom();
  const workers: TestWorker[] = [];
  const manager = new WorkerPoolManager(
    {
      poolSize: 1,
      workerFactory: () => {
        const worker = new TestWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    },
    { langs: [], theme: 'pierre-dark', preferredHighlighter: 'shiki-js' }
  );
  const initialization = manager.initialize();
  const viewer = new CodeView({ disableFileHeader: true }, manager);
  try {
    await waitFor(() => workers.length === 1);
    const initialWorker = workers[0];
    if (initialWorker == null) {
      throw new Error('Initial worker was not created');
    }
    await withTimeout(initialWorker.waitForInitializeRequest());

    viewer.setup(createRoot());
    manager.terminate();
    expect(manager.getStats().managerState).toBe('waiting');
    viewer.setItems([makeFileItem('file:restarted', 3)]);
    viewer.render(true);

    await withTimeout(initialization);
    await waitFor(() => firstRowText(viewer) === 'line 1');
    expect(firstRowText(viewer)).toBe('line 1');
    expect(manager.getStats().managerState).toBe('initializing');

    await waitFor(() => workers.length === 2);
    const restartedWorker = workers[1];
    if (restartedWorker == null) {
      throw new Error('Restarted worker was not created');
    }
    const setup = await withTimeout(restartedWorker.waitForInitializeRequest());
    restartedWorker.respond({
      type: 'success',
      requestType: 'initialize',
      id: setup.id,
      sentAt: Date.now(),
    });
    const request = await withTimeout(restartedWorker.waitForFileRequest());
    expect(request.file.name).toBe('file:restarted.ts');
    expect(initialWorker.terminated).toBe(true);
    expect(initialWorker.fileRequestCount).toBe(0);
    expect(workers).toHaveLength(2);
  } finally {
    viewer.cleanUp();
    manager.terminate();
    dom.cleanup();
  }
});
