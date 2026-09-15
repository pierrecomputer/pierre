import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import type { LanguageRegistration } from 'shiki/core';
import { bundledLanguages } from 'shiki/langs';

import {
  customLanguageLoaders,
  disposeHighlighter,
  getFiletypeFromFileName,
  getHighlighterIfLoaded,
  getSharedHighlighter,
  highlighters,
  parseDiffFromFile,
  registerCustomLanguage,
} from '../src';
import { TextDocument } from '../src/editor/textDocument';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import { WorkerPoolManager } from '../src/worker';
import type { RenderFileRequest } from '../src/worker/types';
import { createDeferred } from './testUtils';
import {
  createInitializedManager,
  installAnimationFramePolyfill,
  respondToFileRequest,
  withTimeout,
} from './workerPoolHarness';

const backends = ['shiki-js', 'shiki-wasm'] as const;
const code = 'hello "world"';

// A small grammar makes custom highlighting distinguishable from plain text.
function grammar(name: string, aliases: string[] = []): LanguageRegistration {
  return {
    name,
    aliases,
    scopeName: `source.${name}`,
    repository: {},
    patterns: [
      { name: 'keyword.control', match: '\\bhello\\b' },
      { name: 'string.quoted.double', begin: '"', end: '"' },
    ],
  };
}

beforeEach(disposeHighlighter);
afterEach(async () => {
  await disposeHighlighter();
  for (const name of customLanguageLoaders.keys()) {
    if (name.startsWith('test-custom-')) customLanguageLoaders.delete(name);
  }
});

for (const preferredHighlighter of backends) {
  test.each(['cold', 'loaded'] as const)(
    `${preferredHighlighter} registers grammars with a %s backend for full, live, and stream tokenization`,
    async (state) => {
      const name = `test-custom-${preferredHighlighter}-${state}`;
      const alias = `${name}-alias`;
      if (state === 'loaded') {
        await getSharedHighlighter({ preferredHighlighter, themes: [] });
      }
      const loader = mock(() =>
        Promise.resolve({ default: [grammar(name, [alias])] })
      );
      registerCustomLanguage(name, loader, [
        name,
        `${name}.config`,
        `${name}file`,
      ]);
      expect(loader).not.toHaveBeenCalled();
      for (const filename of [
        `file.${name}`,
        `file.${name}.config`,
        `${name}file`,
      ]) {
        expect(getFiletypeFromFileName(filename)).toBe(name);
      }
      expect(
        getHighlighterIfLoaded({ preferredHighlighter, langs: [name] })
      ).toBeUndefined();
      const options = {
        preferredHighlighter,
        themes: ['pierre-dark', 'pierre-light'],
        langs: [name],
      };
      const [highlighter] = await Promise.all([
        getSharedHighlighter(options),
        getSharedHighlighter(options),
      ]);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(highlighter.hasLoadedLanguages?.([name, alias])).toBe(true);
      for (const lang of [name, alias]) {
        const tokenOptions = {
          lang,
          theme: {
            dark: highlighter.getTheme('pierre-dark'),
            light: highlighter.getTheme('pierre-light'),
          },
        };
        const { tokens } = highlighter.codeToTokens(code, tokenOptions);
        expect(tokens[0].length).toBeGreaterThan(1);
        const stream = highlighter.createStreamTokenizer(tokenOptions);
        expect(stream.pushCode(code)).toEqual([]);
        expect(stream.end()).toEqual(tokens);
        const live = highlighter.createLiveTokenizer({
          ...tokenOptions,
          textDocument: new TextDocument(`file.${name}`, code),
        });
        try {
          expect(live.getLineTokens(0).tokens).toEqual(tokens[0]);
          expect(
            live.getLineTokens(0).bracketIgnoredRanges.length
          ).toBeGreaterThan(0);
        } finally {
          live.dispose();
        }
      }
    }
  );

  test(`${preferredHighlighter} sees registration during initialization and after disposal`, async () => {
    const name = `test-custom-pending-${preferredHighlighter}`;
    const deferred = createDeferred<void>();
    const backendLoader = highlighters[preferredHighlighter];
    highlighters[preferredHighlighter] = async () => {
      await deferred.promise;
      return backendLoader();
    };
    const options = { preferredHighlighter, themes: [], langs: [name] };
    const pending = getSharedHighlighter(options);
    const loader = mock(() => Promise.resolve({ default: [grammar(name)] }));
    try {
      registerCustomLanguage(name, loader);
    } finally {
      highlighters[preferredHighlighter] = backendLoader;
      deferred.resolve();
    }
    const original = await pending;
    await disposeHighlighter();
    const next = await getSharedHighlighter(options);
    expect(next).not.toBe(original);
    expect(next.hasLoadedLanguages?.([name])).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test(`${preferredHighlighter} retries failed loaders and validates names and aliases`, async () => {
    const name = `test-custom-retry-${preferredHighlighter}`;
    const alias = `${name}-alias`;
    const loader = mock()
      .mockRejectedValueOnce(new Error('grammar unavailable'))
      .mockResolvedValueOnce({ default: [grammar('wrong-name')] })
      .mockResolvedValue({ default: [grammar(name, [alias])] });
    registerCustomLanguage(alias, loader);
    const options = { preferredHighlighter, themes: [], langs: [alias] };
    expect(
      await getSharedHighlighter(options).catch((error: unknown) => error)
    ).toEqual(new Error('grammar unavailable'));
    expect(
      await getSharedHighlighter(options).catch((error: unknown) => error)
    ).toEqual(
      new Error(
        `registerCustomLanguage: No returned grammar declares "${alias}" as its name or an alias.`
      )
    );
    expect(
      getHighlighterIfLoaded({ preferredHighlighter, langs: [alias] })
    ).toBeUndefined();
    const highlighter = await getSharedHighlighter(options);
    expect(highlighter.hasLoadedLanguages?.([name, alias])).toBe(true);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  test(`${preferredHighlighter} rejects an alias added after its grammar was loaded`, async () => {
    const name = `test-custom-existing-${preferredHighlighter}`;
    const alias = `${name}-alias`;
    registerCustomLanguage(name, () =>
      Promise.resolve({ default: [grammar(name)] })
    );
    await getSharedHighlighter({
      preferredHighlighter,
      themes: [],
      langs: [name],
    });
    registerCustomLanguage(alias, () =>
      Promise.resolve({
        default: [grammar(name, [alias])],
      })
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await getSharedHighlighter({
        preferredHighlighter,
        themes: [],
        langs: [alias],
      }).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('load the alias first');
      expect(
        getHighlighterIfLoaded({ preferredHighlighter, langs: [alias] })
      ).toBeUndefined();
    }
  });
}

test('a custom loader is validated even when its bundled alias is already loaded', async () => {
  const preferredHighlighter = 'shiki-js';
  await getSharedHighlighter({
    preferredHighlighter,
    themes: [],
    langs: ['terraform'],
  });
  registerCustomLanguage('tf', bundledLanguages.hcl);
  try {
    const error = await getSharedHighlighter({
      preferredHighlighter,
      themes: [],
      langs: ['tf'],
    }).catch((error: unknown) => error);
    expect(error).toEqual(
      new Error(
        'registerCustomLanguage: No returned grammar declares "tf" as its name or an alias.'
      )
    );
  } finally {
    customLanguageLoaders.delete('tf');
  }
});

test('reserved and duplicate names preserve existing registrations and mappings', async () => {
  const name = 'test-custom-duplicate';
  const loader = mock(() => Promise.resolve({ default: [grammar(name)] }));
  for (const reserved of ['text', 'ansi']) {
    expect(() => registerCustomLanguage(reserved, loader)).toThrow(
      'reserved language names'
    );
  }
  registerCustomLanguage(name, loader, [name]);
  const error = spyOn(console, 'error').mockImplementation(() => {});
  const duplicate = mock(() => Promise.resolve({ default: [grammar(name)] }));
  try {
    registerCustomLanguage(name, duplicate, [`${name}-ignored`]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(getFiletypeFromFileName(`file.${name}-ignored`)).toBe('text');
    await getSharedHighlighter({
      preferredHighlighter: 'shiki-js',
      themes: [],
      langs: [name],
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(duplicate).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});

test.each(['highlights', ...backends])(
  '%s worker pools handle custom languages without loading them for Highlights',
  async (preferredHighlighter) => {
    const restore = installAnimationFramePolyfill();
    const manager = new WorkerPoolManager(
      {
        poolSize: 1,
        workerFactory: () =>
          new Worker(new URL('../src/worker/worker.ts', import.meta.url)),
      },
      { preferredHighlighter, theme: 'pierre-dark' }
    );
    try {
      await withTimeout(manager.initialize());
      const name = `test-custom-worker-${preferredHighlighter}`;
      const loader = mock(() => Promise.resolve({ default: [grammar(name)] }));
      registerCustomLanguage(name, loader, [name]);
      const file = { name: `file.${name}`, contents: code, cacheKey: name };
      await withTimeout(manager.primeFileHighlightCache(file));
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark'],
        langs: [name],
      });
      expect(manager.getFileResultCache(file)?.result).toEqual(
        renderFileWithHighlighter(
          file,
          highlighter,
          manager.getFileRenderOptions()
        )
      );
      const previousName = `${name}-previous`;
      const previousLoader = mock(() =>
        Promise.resolve({ default: [grammar(previousName)] })
      );
      registerCustomLanguage(previousName, previousLoader, [previousName]);
      const diff = parseDiffFromFile(
        { name: `before.${previousName}`, contents: 'hello "before"' },
        file
      );
      diff.cacheKey = `${name}-diff`;
      await withTimeout(manager.primeDiffHighlightCache(diff));
      await getSharedHighlighter({
        preferredHighlighter,
        themes: [],
        langs: [previousName],
      });
      expect(manager.getDiffResultCache(diff)?.result).toEqual(
        renderDiffWithHighlighter(
          diff,
          highlighter,
          manager.getDiffRenderOptions()
        )
      );
      expect(loader).toHaveBeenCalledTimes(
        preferredHighlighter === 'highlights' ? 0 : 1
      );
      expect(previousLoader).toHaveBeenCalledTimes(
        preferredHighlighter === 'highlights' ? 0 : 1
      );
    } finally {
      manager.terminate();
      restore();
    }
  }
);

test('worker failures resend custom grammars until a request succeeds', async () => {
  const restore = installAnimationFramePolyfill();
  const { manager, worker } = await createInitializedManager({
    preferredHighlighter: 'shiki-js',
  });
  const name = 'test-custom-worker-retry';
  registerCustomLanguage(name, () =>
    Promise.resolve({ default: [grammar(name)] })
  );
  const requests: RenderFileRequest[] = [];
  const post = spyOn(worker, 'postMessage').mockImplementation((request) => {
    if (request.type !== 'file') throw new Error('Expected file request');
    requests.push(structuredClone(request));
    if (requests.length === 1) {
      worker.respond({
        type: 'error',
        id: request.id,
        error: 'grammar load failed',
      });
    } else {
      respondToFileRequest(manager, worker, request);
    }
  });
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await withTimeout(
        manager.primeFileHighlightCache({
          name: 'file',
          lang: name,
          contents: code,
          cacheKey: `${name}-${attempt}`,
        })
      ).catch((error: unknown) => error);
      expect(result).toEqual(
        attempt === 0 ? new Error('grammar load failed') : undefined
      );
    }
    expect(
      requests.map((request) =>
        request.resolvedCustomLanguages?.map(({ name }) => name)
      )
    ).toEqual([[name], [name], undefined]);
  } finally {
    manager.terminate();
    post.mockRestore();
    error.mockRestore();
    restore();
  }
});

test.each(['terminate', 'mutate'] as const)(
  'pending worker grammar loading handles %s',
  async (action) => {
    const restore = installAnimationFramePolyfill();
    const { manager, worker } = await createInitializedManager({
      preferredHighlighter: 'shiki-js',
    });
    const name = 'test-custom-worker-canceled';
    const started = createDeferred<void>();
    const deferred = createDeferred<{ default: LanguageRegistration[] }>();
    registerCustomLanguage(name, () => {
      started.resolve();
      return deferred.promise;
    });
    try {
      const file = {
        name: 'file',
        lang: name,
        contents: code,
        cacheKey: name,
      };
      const result = manager
        .primeFileHighlightCache(file)
        .catch((error: unknown) => error);
      await withTimeout(started.promise);
      if (action === 'terminate') {
        manager.terminate();
        expect(String(await withTimeout(result))).toContain('pool terminated');
      } else {
        file.lang = 'text';
        file.contents = 'changed while loading';
        file.cacheKey = `${name}-changed`;
      }
      deferred.resolve({ default: [grammar(name)] });
      if (action === 'terminate') {
        await Bun.sleep(0);
        expect(worker.fileRequestCount).toBe(0);
      } else {
        const request = await withTimeout(worker.waitForFileRequest());
        expect(request.file).toEqual({
          name: 'file',
          lang: name,
          contents: code,
          cacheKey: name,
        });
        respondToFileRequest(manager, worker, request);
        expect(await withTimeout(result)).toBeUndefined();
        expect(manager.getFileResultCache(file)).toBeUndefined();
      }
      expect(manager.getStats().activeTasks).toBe(0);
    } finally {
      deferred.resolve({ default: [grammar(name)] });
      manager.terminate();
      restore();
    }
  }
);
