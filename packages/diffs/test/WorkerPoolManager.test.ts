import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { bundledLanguages } from 'shiki';

import { parseDiffFromFile, registerCustomLanguage } from '../src';
import { RegisteredCustomLanguages } from '../src/highlighter/languages/constants';
import * as sharedHighlighter from '../src/highlighter/shared_highlighter';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import * as themeResolver from '../src/highlighter/themes/resolveThemes';
import type {
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
} from '../src/types';
import { getThemes } from '../src/utils/getThemes';
import {
  isHandledWorkerPoolError,
  WorkerPoolTaskCanceledError,
  WorkerPoolTerminatedError,
  WorkerPoolWorkerError,
} from '../src/worker/errors';
import type {
  DiffRendererInstance,
  FileRendererInstance,
  InitializeWorkerRequest,
  RenderFileRequest,
  SetRenderOptionsWorkerRequest,
  WorkerInitializationRenderOptions,
  WorkerPoolOptions,
  WorkerStats,
} from '../src/worker/types';
import { WorkerPoolManager } from '../src/worker/WorkerPoolManager';
import { createDeferred } from './testUtils';
import {
  createInitializedManager,
  createInitializingManager,
  installAnimationFramePolyfill,
  respondToDiffRequest,
  respondToFileRequest,
  TestWorker,
  withTimeout,
} from './workerPoolHarness';

let restoreAnimationFrame: (() => void) | undefined;

beforeAll(() => {
  restoreAnimationFrame = installAnimationFramePolyfill();
});

afterAll(async () => {
  restoreAnimationFrame?.();
  await disposeHighlighter();
});

afterEach(() => {
  jest.useRealTimers();
  mock.restore();
});

describe('WorkerPoolManager lifecycle', () => {
  test('initializes the pool and its workers with Shiki JS by default', async () => {
    await disposeHighlighter();
    const { manager, worker } = await createInitializedManager();
    try {
      const request = await worker.waitForInitializeRequest();
      expect(manager.getPreferredHighlighter()).toBe('shiki-js');
      expect(request.preferredHighlighter).toBe('shiki-js');
      expect(request.resolvedThemes[0].textmate).toBeDefined();
    } finally {
      manager.terminate();
    }
  });

  test('fails initialization when a worker emits an error', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const worker = new TestWorker();
    const replacement = new TestWorker();
    const { initialization, manager, factory } = createPoolWithAttempts([
      worker,
      replacement,
    ]);
    await worker.waitForInitializeRequest();
    worker.emitError(new Error('worker failed to load'));
    worker.emitError(new Error('another event from the same worker'));
    await replacement.waitForInitializeRequest();
    replacement.emitError(new Error('replacement failed to load'));

    const initializationError = await getRejection(initialization);
    expect(initializationError.message).toContain('replacement failed to load');
    // Without an error callback, consumers still need to log startup
    // failures.
    expect(initializationError).toBeInstanceOf(WorkerPoolWorkerError);
    expect(isHandledWorkerPoolError(initializationError)).toBe(false);
    expect(manager.isWorkingPool()).toBe(false);
    expect(manager.getStats()).toMatchObject({
      managerState: 'waiting',
      activeTasks: 0,
      failedWorkerSlots: 1,
      retryingWorkerSlots: 0,
      totalWorkers: 0,
      workersFailed: true,
    });
    expect(worker.terminated).toBe(true);
    expect(replacement.terminated).toBe(true);
    expect(factory).toHaveBeenCalledTimes(2);
    manager.terminate();
  });

  test('hands a worker error to onWorkerError and logs nothing itself', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const received: Array<{ event: ErrorEvent | Event; worker: Worker }> = [];
    const worker = new TestWorker();
    const replacement = new TestWorker();
    const { initialization, manager } = createPoolWithAttempts(
      [worker, replacement],
      {
        onWorkerError: (event, failedWorker) => {
          received.push({ event, worker: failedWorker });
        },
      }
    );
    await worker.waitForInitializeRequest();

    worker.emitError(new Error('worker failed to load'));
    await replacement.waitForInitializeRequest();
    replacement.emitError(new Error('replacement failed to load'));

    const initializationError = await getRejection(initialization);
    expect(initializationError).toBeInstanceOf(WorkerPoolWorkerError);
    expect(initializationError.message).toContain('replacement failed to load');
    expect(isHandledWorkerPoolError(initializationError)).toBe(true);
    expect(received).toHaveLength(2);
    expect(received[0]?.event).toMatchObject({
      message: 'worker failed to load',
    });
    expect(received[0]?.worker).toBe(worker as unknown as Worker);
    expect(received[1]?.worker).toBe(replacement as unknown as Worker);
    expect(manager.isWorkingPool()).toBe(false);
    // Allow the constructor's error handler to run and check that it does not
    // log the failure already passed to onWorkerError.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleError).not.toHaveBeenCalled();
    manager.terminate();
  });

  test('hands the plain Event of a worker script that failed to load to onWorkerError', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const received: Event[] = [];
    const worker = new TestWorker();
    const replacement = new TestWorker();
    const { initialization, manager } = createPoolWithAttempts(
      [worker, replacement],
      {
        onWorkerError: (event) => {
          received.push(event);
          event.preventDefault();
        },
      }
    );
    await worker.waitForInitializeRequest();

    // Failed script requests can produce an Event without message or error.
    const event = new Event('error', { cancelable: true });
    worker.emitErrorEvent(event);
    await replacement.waitForInitializeRequest();
    const replacementEvent = new Event('error', { cancelable: true });
    replacement.emitErrorEvent(replacementEvent);

    const initializationError = await getRejection(initialization);
    expect(initializationError).toBeInstanceOf(WorkerPoolWorkerError);
    expect(initializationError.message).toContain('failed to load');
    expect(isHandledWorkerPoolError(initializationError)).toBe(true);
    expect(received).toEqual([event, replacementEvent]);
    expect(event.defaultPrevented).toBe(true);
    expect(manager.isWorkingPool()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleError).not.toHaveBeenCalled();
    manager.terminate();
  });

  for (const outcome of ['joins', 'retries', 'fails', 'times out'] as const) {
    test(`keeps serving work when the second worker ${outcome}`, async () => {
      spyOn(console, 'error').mockImplementation(() => {});
      const first = new TestWorker();
      const second = new TestWorker();
      const replacement = new TestWorker();
      const { initialization, manager, factory } = createPoolWithAttempts(
        [first, second, replacement],
        {
          poolSize: 2,
          workerInitializationTimeout:
            outcome === 'times out' ? 100 : undefined,
        }
      );
      try {
        const stats: WorkerStats[] = [];
        manager.subscribeToStatChanges((update) => stats.push(update));
        const firstFile = createCacheableFile('first');
        const firstPrime = manager.primeFileHighlightCache(firstFile);
        const [firstSetup, secondSetup] = await Promise.all([
          first.waitForInitializeRequest(),
          second.waitForInitializeRequest(),
        ]);
        acknowledgeSetup(first, firstSetup);
        await withTimeout(initialization);
        expect(manager.isInitialized()).toBe(true);
        const firstRequest = await first.waitForFileRequest();
        respondToFileRequest(manager, first, firstRequest);
        await withTimeout(firstPrime);
        expect(manager.getFileResultCache(firstFile)).toBeDefined();
        expect(second.fileRequestCount).toBe(0);

        const heldRequestPromise = first.waitForNextFileRequest();
        const heldPrime = manager.primeFileHighlightCache(
          createCacheableFile('held')
        );
        const heldRequest = await heldRequestPromise;
        const nextPrime = manager.primeFileHighlightCache(
          createCacheableFile('next')
        );
        if (outcome === 'retries' || outcome === 'fails') {
          second.respond({
            id: secondSetup.id,
            type: 'error',
            error: 'setup failed',
          });
          const replacementSetup = await replacement.waitForInitializeRequest();
          const retrying = await waitForPoolStats(
            manager,
            (update) => update.retryingWorkerSlots === 1
          );
          expect(retrying).toMatchObject({
            readyWorkers: 1,
            failedWorkerSlots: 0,
            workersFailed: false,
          });
          await new Promise<number>(requestAnimationFrame);
          expect(stats).toContainEqual(retrying);
          const lateSubscriber = mock();
          manager.subscribeToStatChanges(lateSubscriber)();
          expect(lateSubscriber).toHaveBeenCalledWith(retrying);
          if (outcome === 'retries') {
            acknowledgeSetup(replacement, replacementSetup);
          } else {
            replacement.emitError(new Error('setup failed again'));
          }
          expect(second.terminated).toBe(true);
        } else if (outcome === 'joins') {
          acknowledgeSetup(second, secondSetup);
        } else {
          await replacement.waitForInitializeRequest();
          expect(second.terminated).toBe(true);
          expect(manager.getStats()).toMatchObject({
            readyWorkers: 1,
            retryingWorkerSlots: 1,
            workersFailed: false,
          });
        }

        const joined = outcome === 'joins' || outcome === 'retries';
        const expectedState = {
          managerState: 'initialized',
          configuredWorkers: 2,
          readyWorkers: joined ? 2 : 1,
          failedWorkerSlots: joined ? 0 : 1,
          retryingWorkerSlots: 0,
          workersFailed: false,
        };
        if (joined) {
          const readyWorker = outcome === 'joins' ? second : replacement;
          const nextRequest = await readyWorker.waitForFileRequest();
          respondToFileRequest(manager, readyWorker, nextRequest);
          await withTimeout(nextPrime);
          respondToFileRequest(manager, first, heldRequest);
        } else {
          await waitForPoolStats(
            manager,
            (update) => update.failedWorkerSlots === 1
          );
          expect(second.terminated).toBe(true);
          expect(replacement.terminated).toBe(true);
          acknowledgeSetup(second, secondSetup);
          const nextRequestPromise = first.waitForNextFileRequest();
          respondToFileRequest(manager, first, heldRequest);
          respondToFileRequest(manager, first, await nextRequestPromise);
          await withTimeout(nextPrime);
        }
        await withTimeout(heldPrime);
        await waitForPoolStats(manager, (update) => update.activeTasks === 0);
        expect(manager.getStats()).toMatchObject(expectedState);
        expect(first.terminated).toBe(false);
        expect(factory).toHaveBeenCalledTimes(outcome === 'joins' ? 2 : 3);
      } finally {
        manager.terminate();
      }
    });
  }

  test('keeps initializing if a slot exhausts both attempts before another slot replies', async () => {
    const pending = new TestWorker();
    const { initialization, manager, factory } = createPoolWithAttempts(
      [
        new Error('factory failed'),
        new Error('replacement factory failed'),
        pending,
      ],
      { poolSize: 2 }
    );
    try {
      const request = await pending.waitForInitializeRequest();
      expect(factory).toHaveBeenCalledTimes(3);
      expect(manager.isInitialized()).toBe(false);
      expect(manager.isWorkingPool()).toBe(true);
      expect(manager.getStats()).toMatchObject({
        managerState: 'initializing',
        failedWorkerSlots: 1,
        workersFailed: false,
      });
      acknowledgeSetup(pending, request);
      await withTimeout(initialization);
      expect(manager.getStats()).toMatchObject({
        readyWorkers: 1,
        failedWorkerSlots: 1,
        workersFailed: false,
      });
    } finally {
      manager.terminate();
    }
  });

  test('waits for two silent attempts before rejecting queued primes and waking owners', async () => {
    jest.useFakeTimers();
    spyOn(console, 'error').mockImplementation(() => {});
    const first = new TestWorker();
    const retry = new TestWorker();
    const { initialization, manager, factory } = createPoolWithAttempts(
      [first, retry],
      { workerInitializationTimeout: 100 }
    );
    const file = createCacheableFile();
    const owner: FileRendererInstance = {
      __id: 'waiting-file',
      onHighlightSuccess: mock(),
      onHighlightError: mock(),
      onLocalFallback: mock(),
    };
    const prime = getRejection(manager.primeFileHighlightCache(file));
    const diffPrime = getRejection(
      manager.primeDiffHighlightCache(createCacheableDiff())
    );
    manager.highlightFileAST(owner, file);
    manager.highlightFileAST(owner, file);
    try {
      const firstSetup = await first.waitForInitializeRequest();
      jest.advanceTimersByTime(99);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(manager.isWorkingPool()).toBe(true);
      jest.advanceTimersByTime(1);
      const retrySetup = await retry.waitForInitializeRequest();
      expect(first.terminated).toBe(true);
      acknowledgeSetup(first, firstSetup);
      first.emitError(new Error('late error from the timed-out worker'));
      expect(manager.getStats()).toMatchObject({
        managerState: 'initializing',
        retryingWorkerSlots: 1,
        failedWorkerSlots: 0,
      });
      jest.advanceTimersByTime(99);
      expect(manager.isWorkingPool()).toBe(true);
      jest.advanceTimersByTime(1);
      expect(manager.isWorkingPool()).toBe(false);
      const error = await getRejection(initialization);
      expect(error).toBeInstanceOf(WorkerPoolWorkerError);
      expect(error.message).toContain('timed out after 100ms');
      expect(await prime).toBe(error);
      expect(await diffPrime).toBe(error);
      expect(owner.onLocalFallback).toHaveBeenCalledTimes(1);
      expect(owner.onHighlightError).not.toHaveBeenCalled();
      acknowledgeSetup(first, firstSetup);
      acknowledgeSetup(retry, retrySetup);
      expect(manager.getStats()).toMatchObject({
        managerState: 'waiting',
        readyWorkers: 0,
        retryingWorkerSlots: 0,
        failedWorkerSlots: 1,
        queuedTasks: 0,
        activeTasks: 0,
        workersFailed: true,
      });
      expect(first.terminated).toBe(true);
      expect(retry.terminated).toBe(true);
      expect(factory).toHaveBeenCalledTimes(2);
    } finally {
      manager.terminate();
    }
  });

  test('a late failure gives the replacement its full five-second timeout', async () => {
    jest.useFakeTimers();
    spyOn(console, 'error').mockImplementation(() => {});
    const first = new TestWorker();
    const replacement = new TestWorker();
    const { initialization, manager, factory } = createPoolWithAttempts([
      first,
      replacement,
    ]);
    try {
      const firstSetup = await first.waitForInitializeRequest();
      jest.advanceTimersByTime(4_999);
      expect(first.terminated).toBe(false);
      first.emitError(new Error('late failure'));
      first.emitError(new Error('duplicate failure'));
      const replacementSetup = await replacement.waitForInitializeRequest();
      expect(first.terminated).toBe(true);
      acknowledgeSetup(first, firstSetup);
      first.emitError(new Error('retired worker failure'));
      jest.advanceTimersByTime(4_999);
      expect(manager.isInitialized()).toBe(false);
      expect(replacement.terminated).toBe(false);
      acknowledgeSetup(replacement, replacementSetup);
      await withTimeout(initialization);
      jest.advanceTimersByTime(1);
      expect(manager.getStats()).toMatchObject({
        readyWorkers: 1,
        failedWorkerSlots: 0,
        retryingWorkerSlots: 0,
      });
      expect(factory).toHaveBeenCalledTimes(2);
      expect(replacement.terminated).toBe(false);
    } finally {
      manager.terminate();
    }
  });

  test('late workers acknowledge current options before rendering', async () => {
    const ready = new TestWorker();
    const pending = new TestWorker();
    const { initialization, manager } = createPoolWithAttempts(
      [ready, pending],
      { poolSize: 2 }
    );
    try {
      const [readySetup, pendingSetup] = await Promise.all([
        ready.waitForInitializeRequest(),
        pending.waitForInitializeRequest(),
      ]);
      acknowledgeSetup(ready, readySetup);
      await withTimeout(initialization);
      const firstUpdate = manager.setRenderOptions({ theme: 'github-light' });
      acknowledgeSetup(ready, await ready.waitForSetRenderOptionsRequest());
      await withTimeout(firstUpdate);

      const heldPrime = manager.primeFileHighlightCache(
        createCacheableFile('held')
      );
      const heldRequest = await ready.waitForFileRequest();
      const pendingPrime = manager.primeFileHighlightCache(
        createCacheableFile('pending')
      );
      acknowledgeSetup(pending, pendingSetup);
      const pendingUpdate = await pending.waitForSetRenderOptionsRequest();
      expect(pendingUpdate.renderOptions.theme).toBe('github-light');
      expect(pendingUpdate.resolvedThemes.map(({ name }) => name)).toContain(
        'github-light'
      );
      expect(pending.fileRequestCount).toBe(0);
      expect(manager.getStats().readyWorkers).toBe(1);
      acknowledgeSetup(pending, pendingUpdate);
      respondToFileRequest(
        manager,
        pending,
        await pending.waitForFileRequest()
      );
      await withTimeout(pendingPrime);
      respondToFileRequest(manager, ready, heldRequest);
      await withTimeout(heldPrime);
    } finally {
      manager.terminate();
    }
  });

  test('retiring the last ready worker settles old option updates and keeps a starting slot', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const ready = new TestWorker();
    const pending = new TestWorker();
    const { initialization, manager, factory } = createPoolWithAttempts(
      [ready, pending],
      { poolSize: 2 }
    );
    try {
      const [readySetup, pendingSetup] = await Promise.all([
        ready.waitForInitializeRequest(),
        pending.waitForInitializeRequest(),
      ]);
      acknowledgeSetup(ready, readySetup);
      await withTimeout(initialization);
      await manager.initialize();

      const firstUpdate = manager.setRenderOptions({
        tokenizeMaxLineLength: 123,
      });
      const firstRequest = await ready.waitForSetRenderOptionsRequest();
      const latestPosted = createDeferred<SetRenderOptionsWorkerRequest>();
      spyOn(ready, 'postMessage').mockImplementation((request) => {
        if (request.type === 'set-render-options') {
          latestPosted.resolve(request);
        }
      });
      const latestUpdate = getRejection(
        manager.setRenderOptions({ tokenizeMaxLineLength: 456 })
      );
      const latestRequest = await latestPosted.promise;
      await withTimeout(firstUpdate);
      ready.respond({
        type: 'error',
        id: firstRequest.id,
        error: 'superseded update failed',
      });
      expect(ready.terminated).toBe(false);
      const queuedPrime = getRejection(
        manager.primeFileHighlightCache(
          createCacheableFile('waiting-for-options')
        )
      );
      ready.respond({
        type: 'error',
        id: latestRequest.id,
        error: 'latest update failed',
      });
      const latestError = await latestUpdate;
      expect(latestError).toEqual(new Error('latest update failed'));
      const queuedError = await queuedPrime;
      expect(queuedError).toBeInstanceOf(WorkerPoolWorkerError);
      expect(queuedError.cause).toBe(latestError);
      expect(ready.terminated).toBe(true);
      expect(manager.isInitialized()).toBe(true);
      expect(manager.isWorkingPool()).toBe(false);
      await withTimeout(manager.initialize());
      expect(manager.getStats()).toMatchObject({
        managerState: 'initialized',
        readyWorkers: 0,
        failedWorkerSlots: 1,
        workersFailed: false,
      });
      acknowledgeSetup(pending, pendingSetup);
      const catchUp = await pending.waitForSetRenderOptionsRequest();
      expect(catchUp.renderOptions.tokenizeMaxLineLength).toBe(456);
      acknowledgeSetup(pending, catchUp);
      await waitForPoolStats(manager, (stats) => stats.readyWorkers === 1);
      expect(manager.isWorkingPool()).toBe(true);
      expect(factory).toHaveBeenCalledTimes(2);
    } finally {
      manager.terminate();
    }
  });

  test('manual recovery restores service after losing every worker without repeating initialization', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const first = new TestWorker();
    const replacement = new TestWorker();
    const { initialization, manager, factory } = createPoolWithAttempts([
      first,
      replacement,
    ]);
    try {
      acknowledgeSetup(first, await first.waitForInitializeRequest());
      await withTimeout(initialization);

      const update = getRejection(
        manager.setRenderOptions({ tokenizeMaxLineLength: 456 })
      );
      const updateRequest = await first.waitForSetRenderOptionsRequest();
      first.respond({
        id: updateRequest.id,
        type: 'error',
        error: 'worker could not apply options',
      });
      await update;
      expect(manager.isInitialized()).toBe(true);
      expect(manager.isWorkingPool()).toBe(false);
      expect(manager.getStats()).toMatchObject({
        managerState: 'initialized',
        failedWorkerSlots: 1,
        readyWorkers: 0,
        workersFailed: true,
      });
      await withTimeout(manager.initialize());
      expect(factory).toHaveBeenCalledTimes(1);

      const recovery = manager.retryFailedWorkers();
      const setup = await replacement.waitForInitializeRequest();
      expect(setup.renderOptions.tokenizeMaxLineLength).toBe(456);
      expect(manager.isWorkingPool()).toBe(false);
      await withTimeout(manager.initialize());
      acknowledgeSetup(first, updateRequest);
      expect(manager.getStats().readyWorkers).toBe(0);
      acknowledgeSetup(replacement, setup);
      expect(await withTimeout(recovery)).toMatchObject({
        managerState: 'initialized',
        failedWorkerSlots: 0,
        readyWorkers: 1,
        workersFailed: false,
      });
      expect(manager.isWorkingPool()).toBe(true);
      expect(factory).toHaveBeenCalledTimes(2);
    } finally {
      manager.terminate();
    }
  });

  test('terminating a partial pool discards pending setup and starts with the current options', async () => {
    const workers = [new TestWorker(), new TestWorker()];
    const restarted = [new TestWorker(), new TestWorker()];
    const { initialization, manager, factory } = createPoolWithAttempts(
      [...workers, ...restarted],
      { poolSize: 2 }
    );
    try {
      const [firstSetup, lateSetup] = await Promise.all(
        workers.map((worker) => worker.waitForInitializeRequest())
      );
      acknowledgeSetup(workers[0], firstSetup);
      await withTimeout(initialization);
      const update = manager.setRenderOptions({ theme: 'github-light' });
      const firstUpdate = await workers[0].waitForSetRenderOptionsRequest();
      manager.terminate();
      await withTimeout(update);
      expect(manager.getStats()).toMatchObject({
        managerState: 'waiting',
        readyWorkers: 0,
        failedWorkerSlots: 0,
        activeTasks: 0,
      });
      const nextInitialization = manager.initialize();
      const [newSetup] = await Promise.all(
        restarted.map((worker) => worker.waitForInitializeRequest())
      );
      acknowledgeSetup(workers[0], firstUpdate);
      acknowledgeSetup(workers[1], lateSetup);
      expect(manager.isInitialized()).toBe(false);
      expect(newSetup.renderOptions.theme).toBe('github-light');
      acknowledgeSetup(restarted[0], newSetup);
      await withTimeout(nextInitialization);
      expect(factory).toHaveBeenCalledTimes(4);
      expect(workers.every((worker) => worker.terminated)).toBe(true);
    } finally {
      manager.terminate();
    }
  });

  test('a shared setup rejection stops startup without marking worker slots failed', async () => {
    const theme = 'worker-setup-rejected';
    const error = new Error('theme could not load');
    const originalResolve = themeResolver.resolveThemes;
    spyOn(themeResolver, 'resolveThemes').mockImplementation((themes, engine) =>
      themes.includes(theme)
        ? Promise.reject(error)
        : originalResolve(themes, engine)
    );
    spyOn(console, 'error').mockImplementation(() => {});
    const worker = new TestWorker();
    const freshWorker = new TestWorker();
    const { initialization, manager, factory } = createPoolWithAttempts(
      [worker, freshWorker],
      {},
      { theme, langs: ['typescript'] }
    );
    try {
      const prime = getRejection(
        manager.primeFileHighlightCache(createCacheableFile())
      );
      expect(await getRejection(initialization)).toBe(error);
      expect(await prime).toBe(error);
      expect(manager.isWorkingPool()).toBe(false);
      expect(
        manager.getPlainFileAST(createCacheableFile(), 0, 1)
      ).toBeUndefined();
      expect(await manager.retryFailedWorkers()).toMatchObject({
        managerState: 'waiting',
        readyWorkers: 0,
        failedWorkerSlots: 0,
        queuedTasks: 0,
        workersFailed: false,
      });
      expect(factory).not.toHaveBeenCalled();

      await manager.setRenderOptions({ theme: 'github-light' });
      const setup = await worker.waitForInitializeRequest();
      expect(setup.renderOptions.theme).toBe('github-light');
      expect(setup.resolvedLanguages?.map(({ name }) => name)).toEqual([
        'typescript',
      ]);
      acknowledgeSetup(worker, setup);
      await manager.initialize();
      expect(manager.isWorkingPool()).toBe(true);

      manager.terminate();
      const freshInitialization = manager.initialize();
      const freshSetup = await freshWorker.waitForInitializeRequest();
      expect(freshSetup.resolvedLanguages).toEqual([]);
      acknowledgeSetup(freshWorker, freshSetup);
      await withTimeout(freshInitialization);
    } finally {
      manager.terminate();
    }
  });

  for (const replaceLanguages of [false, true]) {
    test(`explicit initialization retries a rejected preload with ${replaceLanguages ? 'replacement' : 'original'} languages`, async () => {
      spyOn(console, 'error').mockImplementation(() => {});
      await sharedHighlighter.getSharedHighlighter({
        themes: ['github-dark'],
        langs: [],
      });
      const language = 'worker-retry-language';
      const error = new Error('language could not load');
      const firstLoad = createDeferred<void>();
      let recovered = false;
      const loader = mock(async () => {
        if (!recovered) {
          await firstLoad.promise;
        }
        return {
          default: [
            {
              name: language,
              scopeName: 'source.retry',
              patterns: [],
              repository: {},
            },
          ],
        };
      });
      registerCustomLanguage(language, loader);
      const worker = new TestWorker();
      const { manager, initialization, factory } = createPoolWithAttempts(
        [worker],
        {},
        { langs: [language] }
      );
      try {
        firstLoad.reject(error);
        expect(await getRejection(initialization)).toBe(error);
        expect(factory).not.toHaveBeenCalled();

        recovered = true;
        const languages = replaceLanguages ? ['typescript'] : undefined;
        const retry = manager.initialize(languages);
        const overlapping = manager.initialize([]);
        const setup = await worker.waitForInitializeRequest();
        expect(setup.resolvedLanguages?.map(({ name }) => name)).toEqual(
          languages ?? [language]
        );
        expect(loader).toHaveBeenCalledTimes(replaceLanguages ? 1 : 2);
        acknowledgeSetup(worker, setup);
        await withTimeout(Promise.all([retry, overlapping]));
        expect(manager.getStats().readyWorkers).toBe(1);
        expect(factory).toHaveBeenCalledTimes(1);
      } finally {
        manager.terminate();
        RegisteredCustomLanguages.delete(language);
        await disposeHighlighter();
      }
    });
  }

  for (const rejectObsolete of [false, true]) {
    test(`initializes with the committed theme before the obsolete theme ${rejectObsolete ? 'rejects' : 'resolves'}`, async () => {
      const theme = 'worker-obsolete-theme';
      const obsolete =
        createDeferred<
          Awaited<ReturnType<typeof themeResolver.resolveThemes>>
        >();
      const originalResolve = themeResolver.resolveThemes;
      spyOn(themeResolver, 'resolveThemes').mockImplementation(
        (themes, engine) =>
          themes.includes(theme)
            ? obsolete.promise
            : originalResolve(themes, engine)
      );
      spyOn(console, 'error').mockImplementation(() => {});
      const worker = new TestWorker();
      const { initialization, manager, factory } = createPoolWithAttempts(
        [worker],
        {},
        { theme, langs: ['typescript'] }
      );
      try {
        await manager.setRenderOptions({ theme: 'github-light' });
        const setup = await withTimeout(worker.waitForInitializeRequest());
        expect(setup.renderOptions.theme).toBe('github-light');
        expect(setup.resolvedThemes.map(({ name }) => name)).toEqual([
          'github-light',
        ]);
        expect(setup.resolvedLanguages?.map(({ name }) => name)).toEqual([
          'typescript',
        ]);
        acknowledgeSetup(worker, setup);
        await withTimeout(initialization);

        if (rejectObsolete) {
          obsolete.reject(new Error('obsolete theme failed'));
        } else {
          obsolete.resolve(await originalResolve(['github-dark'], 'shiki-js'));
        }
        await manager.initialize();
        expect(manager.getFileRenderOptions().theme).toBe('github-light');
        expect(manager.getStats().readyWorkers).toBe(1);
        expect(factory).toHaveBeenCalledTimes(1);
      } finally {
        manager.terminate();
        obsolete.resolve([]);
      }
    });
  }

  test('concurrent host retries claim only failed slots and preserve each deadline', async () => {
    jest.useFakeTimers();
    spyOn(console, 'error').mockImplementation(() => {});
    const [ready, retryB, retryC, newerB] = Array.from(
      { length: 4 },
      () => new TestWorker()
    );
    const attempts = Array.from(
      { length: 4 },
      () => new Error('initial factory failed')
    );
    const { initialization, manager, factory } = createPoolWithAttempts(
      [ready, ...attempts, retryB, retryC, newerB],
      { poolSize: 3, workerInitializationTimeout: 100 }
    );
    try {
      acknowledgeSetup(ready, await ready.waitForInitializeRequest());
      await withTimeout(initialization);
      expect(manager.getStats().failedWorkerSlots).toBe(2);
      const heldPrime = manager.primeFileHighlightCache(
        createCacheableFile('held')
      );
      const heldRequest = await ready.waitForFileRequest();
      const retry = manager.retryFailedWorkers();
      const immediate = await manager.retryFailedWorkers();
      expect(immediate).toMatchObject({
        retryingWorkerSlots: 2,
        failedWorkerSlots: 0,
        readyWorkers: 1,
        busyWorkers: 3,
        workersFailed: false,
      });
      expect(factory).toHaveBeenCalledTimes(7);
      const retryBSetup = await retryB.waitForInitializeRequest();
      const retryCSetup = await retryC.waitForInitializeRequest();
      jest.advanceTimersByTime(80);
      retryB.emitError(new Error('B retry failed'));
      await Promise.resolve();
      expect(factory).toHaveBeenCalledTimes(7);
      expect(manager.getStats().failedWorkerSlots).toBe(1);
      const newerRetry = manager.retryFailedWorkers();
      expect(factory).toHaveBeenCalledTimes(8);
      expect(manager.getStats().retryingWorkerSlots).toBe(2);
      await manager.retryFailedWorkers();
      const newerBSetup = await newerB.waitForInitializeRequest();
      acknowledgeSetup(retryB, retryBSetup);
      const nextFile = createCacheableFile('next');
      const nextPrime = manager.primeFileHighlightCache(nextFile);
      acknowledgeSetup(newerB, newerBSetup);
      expect(await withTimeout(newerRetry)).toMatchObject({
        retryingWorkerSlots: 1,
        readyWorkers: 2,
      });
      respondToFileRequest(manager, newerB, await newerB.waitForFileRequest());
      await withTimeout(nextPrime);
      expect(manager.getFileResultCache(nextFile)).toBeDefined();
      jest.advanceTimersByTime(20);
      expect(await withTimeout(retry)).toMatchObject({
        readyWorkers: 2,
        failedWorkerSlots: 1,
        retryingWorkerSlots: 0,
      });
      acknowledgeSetup(retryC, retryCSetup);
      expect(retryC.terminated).toBe(true);
      expect(factory).toHaveBeenCalledTimes(8);
      expect(manager.getStats().readyWorkers).toBe(2);
      respondToFileRequest(manager, ready, heldRequest);
      await withTimeout(heldPrime);
    } finally {
      manager.terminate();
    }
  });

  test('keeps full fallback through failed host retries and dispatches after the first recovery', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('worker factory unavailable');
    const recovered = new TestWorker();
    const pending = new TestWorker();
    const { initialization, manager, factory } = createPoolWithAttempts(
      [...Array<Error>(9).fill(error), recovered, pending, error],
      { poolSize: 3 }
    );
    try {
      const initialError = await getRejection(initialization);
      expect(initialError).toBeInstanceOf(WorkerPoolWorkerError);
      expect(await manager.retryFailedWorkers()).toMatchObject({
        workersFailed: true,
        failedWorkerSlots: 3,
        retryingWorkerSlots: 0,
      });
      expect(factory).toHaveBeenCalledTimes(9);
      const retry = manager.retryFailedWorkers();
      const [recoveredSetup, pendingSetup] = await Promise.all([
        recovered.waitForInitializeRequest(),
        pending.waitForInitializeRequest(),
      ]);
      expect(manager.isWorkingPool()).toBe(false);
      expect(manager.isInitialized()).toBe(false);
      expect(await getRejection(manager.initialize())).toBe(initialError);
      expect(manager.getStats()).toMatchObject({
        workersFailed: true,
        failedWorkerSlots: 1,
        retryingWorkerSlots: 2,
      });
      acknowledgeSetup(recovered, recoveredSetup);
      await Promise.resolve();
      expect(manager.isWorkingPool()).toBe(true);
      await withTimeout(manager.initialize());
      expect(await getRejection(initialization)).toBe(initialError);
      const file = createCacheableFile();
      const prime = manager.primeFileHighlightCache(file);
      respondToFileRequest(
        manager,
        recovered,
        await recovered.waitForFileRequest()
      );
      await withTimeout(prime);
      expect(manager.getFileResultCache(file)).toBeDefined();

      manager.terminate();
      expect(await withTimeout(retry)).toMatchObject({
        managerState: 'waiting',
        readyWorkers: 0,
        workersFailed: false,
        failedWorkerSlots: 0,
        retryingWorkerSlots: 0,
      });
      acknowledgeSetup(pending, pendingSetup);
      expect(await manager.retryFailedWorkers()).toEqual(manager.getStats());
      expect(factory).toHaveBeenCalledTimes(12);
      expect(manager.isInitialized()).toBe(false);
    } finally {
      manager.terminate();
    }
  });

  test('initialization reports the terminal failure of each slot', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const firstSlotError = new Error('first slot exhausted');
    const secondSlotError = new Error('second slot exhausted');
    const { initialization, manager } = createPoolWithAttempts(
      [
        new Error('first attempt failed'),
        firstSlotError,
        new Error('second attempt failed'),
        secondSlotError,
      ],
      { poolSize: 2 }
    );
    try {
      const error = await getRejection(initialization);
      expect(error).toBeInstanceOf(WorkerPoolWorkerError);
      expect(error.message).toContain('all 2 worker slots failed');
      expect(isHandledWorkerPoolError(error)).toBe(false);
      const { cause } = error;
      if (!(cause instanceof AggregateError)) {
        throw new Error('Expected an AggregateError');
      }
      expect(cause.errors.map((error: Error) => error.cause)).toEqual([
        firstSlotError,
        secondSlotError,
      ]);
    } finally {
      manager.terminate();
    }
  });

  test('ignores stale initialization after terminate', async () => {
    const { initialization, manager, worker } = createInitializingManager();
    const request = await worker.waitForInitializeRequest();

    worker.respond({
      type: 'success',
      requestType: 'initialize',
      id: request.id,
      sentAt: Date.now(),
    });
    manager.terminate();

    await withTimeout(initialization);
    expect(manager.getStats()).toMatchObject({
      managerState: 'waiting',
      activeTasks: 0,
      totalWorkers: 0,
      workersFailed: false,
    });
    expect(worker.terminated).toBe(true);
  });

  test('settles initialization when terminate cancels active worker setup', async () => {
    const { initialization, manager, worker } = createInitializingManager();
    await worker.waitForInitializeRequest();

    manager.terminate();

    await withTimeout(initialization);
    expect(manager.getStats()).toMatchObject({
      managerState: 'waiting',
      activeTasks: 0,
      totalWorkers: 0,
      workersFailed: false,
    });
    expect(worker.terminated).toBe(true);
  });
});

describe('WorkerPoolManager cache priming', () => {
  for (const rejectLanguage of [true, false]) {
    test(`a worker ${rejectLanguage ? 'rejection resends' : 'success reuses'} the requested language on the next task`, async () => {
      await disposeHighlighter();
      const { manager, worker } = await createInitializedManager({
        preferredHighlighter: 'shiki-js',
      });
      const mismatch =
        'attachResolvedLanguages: No returned grammar declares "tf" as its name or an alias.';
      if (rejectLanguage) {
        registerCustomLanguage('tf', bundledLanguages.hcl);
        spyOn(console, 'error').mockImplementation(() => {});
      }
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const posted = createDeferred<RenderFileRequest>();
          spyOn(worker, 'postMessage').mockImplementation((request) => {
            if (request.type === 'file') {
              posted.resolve(structuredClone(request));
            }
          });
          const prime = manager.primeFileHighlightCache({
            name: 'example.tf',
            contents: `locals { label = "${attempt}" }`,
            cacheKey: `terraform:${attempt}`,
          });
          const settled = prime.catch((error: unknown) => error);
          const request = await withTimeout(posted.promise);
          if (rejectLanguage) {
            worker.respond({
              type: 'error',
              id: request.id,
              error: mismatch,
            });
            expect(await withTimeout(settled)).toEqual(new Error(mismatch));
            expect(request.resolvedLanguages?.map(({ name }) => name)).toEqual([
              'tf',
            ]);
            expect(
              request.resolvedLanguages?.[0]?.data.map(({ name }) => name)
            ).toEqual(['hcl']);
          } else {
            respondToFileRequest(manager, worker, request);
            expect(await withTimeout(settled)).toBeUndefined();
            if (attempt === 0) {
              expect(
                request.resolvedLanguages?.map(({ name }) => name)
              ).toEqual(['tf']);
            } else {
              expect(request.resolvedLanguages).toBeUndefined();
            }
          }
        }
      } finally {
        manager.terminate();
        RegisteredCustomLanguages.delete('tf');
        await disposeHighlighter();
      }
    });
  }

  test('reports a background preload failure without blocking worker rendering', async () => {
    await disposeHighlighter();
    const { manager, worker } = await createInitializedManager({
      preferredHighlighter: 'shiki-js',
    });
    const highlighter = await sharedHighlighter.getSharedHighlighter({
      themes: [],
      langs: [],
    });
    const preload = createDeferred<DiffsHighlighter>();
    const logged = createDeferred<unknown>();
    const error = new Error('Shared highlighter preload failed');
    spyOn(sharedHighlighter, 'getSharedHighlighter').mockImplementation(
      () => preload.promise
    );
    const logError = spyOn(console, 'error').mockImplementation((error) => {
      logged.resolve(error);
    });
    try {
      const file = { ...createCacheableFile(), lang: 'css' as const };
      const prime = manager.primeFileHighlightCache(file);
      const request = await withTimeout(worker.waitForFileRequest());
      respondToFileRequest(manager, worker, request);
      await withTimeout(prime);
      expect(manager.getFileResultCache(file)).toBeDefined();

      preload.reject(error);
      expect(await withTimeout(logged.promise)).toBe(error);
      expect(logError).toHaveBeenCalledTimes(1);
      expect(manager.isWorkingPool()).toBe(true);
      expect(manager.getStats().activeTasks).toBe(0);
    } finally {
      preload.resolve(highlighter);
      manager.terminate();
    }
  });

  test('does not read or populate the shared cache for an unkeyed diff', async () => {
    const { manager, worker } = await createInitializedManager();
    const successes: FileDiffMetadata[] = [];
    const instance: DiffRendererInstance = {
      __id: 'unkeyed-diff-renderer',
      onLocalFallback: mock(),
      onHighlightSuccess(diff) {
        successes.push(diff);
      },
      onHighlightError(error) {
        throw error;
      },
    };
    const diff = parseDiffFromFile(
      { name: 'file.ts', contents: 'const value = "old";\n' },
      { name: 'file.ts', contents: 'const value = "new";\n' }
    );
    const sentinel = {
      result: {
        code: { additionLines: [], deletionLines: [] },
        themeStyles: 'sentinel',
        baseThemeType: undefined,
      },
      options: manager.getDiffRenderOptions(),
    };

    try {
      expect(diff.cacheKey).toBeUndefined();
      manager.inspectCaches().diffCache.set(diff.name, sentinel);
      expect(manager.getDiffResultCache(diff)).toBeUndefined();

      manager.highlightDiffAST(instance, diff);
      const request = await worker.waitForDiffRequest();
      expect(request.diff.cacheKey).toBeUndefined();

      respondToDiffRequest(manager, worker, request);

      expect(successes).toEqual([diff]);
      expect(manager.inspectCaches().diffCache.size).toBe(1);
      expect(manager.inspectCaches().diffCache.get(diff.name)).toBe(sentinel);
      expect(manager.getDiffResultCache(diff)).toBeUndefined();
    } finally {
      manager.cleanUpTasks(instance);
      manager.terminate();
    }
  });

  test('primeDiffHighlightCache resolves after a successful response populates the diff cache', async () => {
    const { manager, worker } = await createInitializedManager();
    try {
      const diff = createCacheableDiff();
      const prime = manager.primeDiffHighlightCache(diff);
      const request = await worker.waitForDiffRequest();

      expect(request.diff).toEqual(diff);
      expect(request.diff).not.toBe(diff);
      expect(manager.getDiffResultCache(diff)).toBeUndefined();

      respondToDiffRequest(manager, worker, request);
      await withTimeout(prime);

      expect(manager.getDiffResultCache(diff)).toBeDefined();
    } finally {
      manager.terminate();
    }
  });

  test('stores a diff result under the cache key dispatched to the worker', async () => {
    const { initialization, manager, worker } = createInitializingManager();
    try {
      const diff = createCacheableDiff();
      const initialCacheKey = diff.cacheKey;
      if (initialCacheKey == null) {
        throw new Error('expected a cacheable diff');
      }
      const prime = manager.primeDiffHighlightCache(diff);

      diff.cacheKey = `${initialCacheKey}:queued`;
      const initializeRequest = await worker.waitForInitializeRequest();
      worker.respond({
        type: 'success',
        requestType: 'initialize',
        id: initializeRequest.id,
        sentAt: Date.now(),
      });
      await withTimeout(initialization);
      const request = await worker.waitForDiffRequest();
      const dispatchedCacheKey = request.diff.cacheKey;
      if (dispatchedCacheKey == null) {
        throw new Error('expected a dispatched cache key');
      }

      diff.cacheKey = `${dispatchedCacheKey}:hydrated`;
      respondToDiffRequest(manager, worker, request);
      await withTimeout(prime);

      expect(
        manager.getDiffResultCache({ ...diff, cacheKey: dispatchedCacheKey })
      ).toBeDefined();
      expect(
        manager.getDiffResultCache({ ...diff, cacheKey: initialCacheKey })
      ).toBeUndefined();
      expect(manager.getDiffResultCache(diff)).toBeUndefined();
    } finally {
      manager.terminate();
    }
  });

  test('stores a file result under the cache key dispatched to the worker', async () => {
    const { manager, worker } = await createInitializedManager();
    try {
      const file = createCacheableFile();
      const prime = manager.primeFileHighlightCache(file);
      const request = await worker.waitForFileRequest();
      const dispatchedCacheKey = request.file.cacheKey;
      if (dispatchedCacheKey == null) {
        throw new Error('expected a dispatched cache key');
      }

      file.cacheKey = `${dispatchedCacheKey}:edited`;
      respondToFileRequest(manager, worker, request);
      await withTimeout(prime);

      expect(
        manager.getFileResultCache({ ...file, cacheKey: dispatchedCacheKey })
      ).toBeDefined();
      expect(manager.getFileResultCache(file)).toBeUndefined();
    } finally {
      manager.terminate();
    }
  });

  test('primeDiffHighlightCache awaits an existing matching render task', async () => {
    const { manager, worker } = await createInitializedManager();
    const successes: FileDiffMetadata[] = [];
    const instance: DiffRendererInstance = {
      __id: 'diff-renderer',
      onLocalFallback: mock(),
      onHighlightSuccess(diff) {
        successes.push(diff);
      },
      onHighlightError(error) {
        throw error;
      },
    };

    try {
      const diff = createCacheableDiff();
      manager.highlightDiffAST(instance, diff);
      const request = await worker.waitForDiffRequest();

      const prime = manager.primeDiffHighlightCache(diff);
      await Promise.resolve();

      expect(worker.diffRequestCount).toBe(1);
      respondToDiffRequest(manager, worker, request);
      await withTimeout(prime);

      expect(manager.getDiffResultCache(diff)).toBeDefined();
      expect(successes).toEqual([diff]);
    } finally {
      manager.cleanUpTasks(instance);
      manager.terminate();
    }
  });

  test('primeDiffHighlightCache rejects when an active task is terminated', async () => {
    const { manager, worker } = await createInitializedManager();
    try {
      const prime = manager.primeDiffHighlightCache(createCacheableDiff());
      await worker.waitForDiffRequest();

      manager.terminate();

      let rejectedError: unknown;
      try {
        await prime;
      } catch (error) {
        rejectedError = error;
      }

      expect(rejectedError).toBeInstanceOf(WorkerPoolTerminatedError);
      expect((rejectedError as Error).message).toContain('pool terminated');
      // Components should ignore expected cancellations when logging errors.
      expect(isHandledWorkerPoolError(rejectedError)).toBe(true);
    } finally {
      manager.terminate();
    }
  });
});

describe('WorkerPoolManager main-thread threshold', () => {
  test('primes and reuses main-thread diff results with the pool diff library', async () => {
    for (const preferredDiffLib of ['@pierre/patches', 'jsdiff'] as const) {
      const { manager, worker } = await createInitializedManager(
        { preferredDiffLib },
        { mainThreadMaxCharacters: 1000 }
      );
      const diff = createCacheableDiff();
      try {
        await manager.primeDiffHighlightCache(diff);
        const cached = manager.getDiffResultCache(diff);
        expect(cached?.options.preferredDiffLib).toBe(preferredDiffLib);
        expect(cached?.result.code.additionLines.length).toBeGreaterThan(0);

        await manager.primeDiffHighlightCache(diff);
        expect(manager.getDiffResultCache(diff)).toBe(cached);
        expect(worker.diffRequestCount).toBe(0);
      } finally {
        manager.terminate();
      }
    }
  });

  test('routes files and diffs by character count against the threshold', async () => {
    const file = createCacheableFile();
    const diff = createCacheableDiff();
    const diffCharacters =
      diff.deletionCharacterCount + diff.additionCharacterCount;
    const unset = await createInitializedManager();
    const atFile = await createInitializedManager(
      {},
      { mainThreadMaxCharacters: file.contents.length }
    );
    const belowDiff = await createInitializedManager(
      {},
      { mainThreadMaxCharacters: diffCharacters - 1 }
    );
    try {
      expect(unset.manager.shouldHighlightOnMainThread(file)).toBe(false);
      expect(unset.manager.shouldHighlightOnMainThread(diff)).toBe(false);

      expect(atFile.manager.shouldHighlightOnMainThread(file)).toBe(true);
      expect(
        atFile.manager.shouldHighlightOnMainThread({
          ...file,
          contents: `${file.contents} `,
        })
      ).toBe(false);

      // Diffs count both sides, so one character under their sum routes the
      // diff to a worker even though each side alone fits.
      expect(belowDiff.manager.shouldHighlightOnMainThread(diff)).toBe(false);
      expect(
        belowDiff.manager.shouldHighlightOnMainThread({
          ...diff,
          additionCharacterCount: diff.additionCharacterCount - 1,
        })
      ).toBe(true);
    } finally {
      unset.manager.terminate();
      atFile.manager.terminate();
      belowDiff.manager.terminate();
    }
  });

  test('rejects a main-thread prime whose language load outlives terminate', async () => {
    const { manager } = await createInitializedManager(
      {},
      { mainThreadMaxCharacters: 1000 }
    );
    // With no highlighter loaded, this prime has to wait for its grammar.
    await disposeHighlighter();
    const file: FileContents = {
      name: 'prime.py',
      contents: 'value = [1, 2]\n',
      cacheKey: 'main-thread:terminated',
    };
    const prime = manager.primeFileHighlightCache(file);
    manager.terminate();

    expect(await getRejection(prime)).toBeInstanceOf(WorkerPoolTerminatedError);
    expect(manager.getFileResultCache(file)).toBeUndefined();
  });

  test('cancels a main-thread prime whose render options change while loading', async () => {
    const { manager } = await createInitializedManager(
      {},
      { mainThreadMaxCharacters: 1000 }
    );
    try {
      // Nothing else in this file loads Ruby, so this prime waits for it.
      const file: FileContents = {
        name: 'prime.rb',
        contents: 'value = [1, 2]\n',
        cacheKey: 'main-thread:options-changed',
      };
      const prime = manager.primeFileHighlightCache(file);
      // The theme is unchanged, so the new options apply synchronously; the
      // workers never acknowledge them in this harness, so don't await it.
      void manager.setRenderOptions({ tokenizeMaxLineLength: 500 });

      expect(await getRejection(prime)).toBeInstanceOf(
        WorkerPoolTaskCanceledError
      );
      expect(manager.getFileResultCache(file)).toBeUndefined();
    } finally {
      manager.terminate();
    }
  });

  test('cancels a main-thread prime whose highlighter is disposed while loading', async () => {
    const { manager } = await createInitializedManager(
      {},
      { mainThreadMaxCharacters: 1000 }
    );
    try {
      // With no highlighter loaded, this prime has to wait for its grammar.
      await disposeHighlighter();
      const file: FileContents = {
        name: 'prime.py',
        contents: 'value = [1, 2]\n',
        cacheKey: 'main-thread:disposed',
      };
      const prime = manager.primeFileHighlightCache(file);
      await disposeHighlighter();

      expect(await getRejection(prime)).toBeInstanceOf(
        WorkerPoolTaskCanceledError
      );
      expect(manager.getFileResultCache(file)).toBeUndefined();
    } finally {
      manager.terminate();
    }
  });

  test('keeps a main-thread prime that completes while workers initialize', async () => {
    const { initialization, manager, worker } = createInitializingManager(
      {},
      { mainThreadMaxCharacters: 1000 }
    );
    try {
      await sharedHighlighter.getSharedHighlighter({
        themes: getThemes(manager.getFileRenderOptions().theme),
        langs: ['typescript'],
        preferredHighlighter: manager.getPreferredHighlighter(),
      });
      const file = createCacheableFile('main-thread:during-initialize');
      const prime = manager.primeFileHighlightCache(file);
      expect(manager.getFileResultCache(file)).toBeDefined();
      await withTimeout(prime);

      const request = await worker.waitForInitializeRequest();
      worker.respond({
        type: 'success',
        requestType: 'initialize',
        id: request.id,
        sentAt: Date.now(),
      });
      await withTimeout(initialization);

      expect(manager.getFileResultCache(file)).toBeDefined();
    } finally {
      manager.terminate();
    }
  });

  test('drops shared results rendered with outdated options', async () => {
    const { manager } = await createInitializedManager();
    try {
      const file = createCacheableFile();
      const result = { code: [], themeStyles: '', baseThemeType: undefined };
      const options = manager.getFileRenderOptions();
      manager.setFileResultCache(file.cacheKey, {
        result,
        options: { ...options, tokenizeMaxLineLength: 5 },
      });
      expect(manager.getFileResultCache(file)).toBeUndefined();

      manager.setFileResultCache(file.cacheKey, { result, options });
      expect(manager.getFileResultCache(file)).toEqual({ result, options });
    } finally {
      manager.terminate();
    }
  });
});

function createPoolWithAttempts(
  attempts: (TestWorker | Error)[],
  poolOptions: Omit<WorkerPoolOptions, 'workerFactory'> = {},
  initializationOptions: Partial<WorkerInitializationRenderOptions> = {}
) {
  let nextAttempt = 0;
  const factory = mock(() => {
    const worker = attempts[nextAttempt++];
    if (worker instanceof Error) {
      throw worker;
    }
    if (worker == null) {
      throw new Error('Unexpected test worker attempt');
    }
    return worker as unknown as Worker;
  });
  const manager = new WorkerPoolManager(
    { poolSize: 1, workerFactory: factory, ...poolOptions },
    { langs: [], theme: 'github-dark', ...initializationOptions }
  );
  return { manager, initialization: manager.initialize(), factory };
}

function acknowledgeSetup(
  worker: TestWorker,
  request: InitializeWorkerRequest | SetRenderOptionsWorkerRequest
): void {
  worker.respond({
    type: 'success',
    requestType: request.type,
    id: request.id,
    sentAt: Date.now(),
  });
}

async function waitForPoolStats(
  manager: WorkerPoolManager,
  predicate: (stats: WorkerStats) => boolean
): Promise<WorkerStats> {
  const result = createDeferred<WorkerStats>();
  const unsubscribe = manager.subscribeToStatChanges((stats) => {
    if (predicate(stats)) {
      result.resolve(stats);
    }
  });
  try {
    return await withTimeout(result.promise);
  } finally {
    unsubscribe();
  }
}

function createCacheableDiff(): FileDiffMetadata {
  const oldFile = createCacheableFile('file:old', 'const value = "old";\n');
  const newFile = createCacheableFile('file:new', 'const value = "new";\n');
  return parseDiffFromFile(oldFile, newFile);
}

async function getRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await withTimeout(promise);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('Expected promise to reject');
}

function createCacheableFile(
  cacheKey = 'file:cache',
  contents = 'const value = true;\n'
): FileContents {
  return {
    name: 'file.ts',
    contents,
    cacheKey,
  };
}
