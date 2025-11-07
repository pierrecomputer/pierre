/**
 * Worker-based Shiki rendering
 *
 * This module provides infrastructure for offloading Shiki's syntax highlighting
 * work to Web Worker threads, preventing main thread blocking.
 *
 * ## Basic Usage
 *
 * import { createShikiWorkerAPI } from '@pierre/precision-diffs/worker';
 *
 * Create a worker API instance
 * const workerAPI = createShikiWorkerAPI('/path/to/shiki-worker.js', {
 *   poolSize: 4,
 *   initOptions: {
 *     themes: ['github-dark', 'github-light'],
 *     langs: ['typescript', 'javascript'],
 *   },
 * });
 *
 * Render a file
 * const file = { name: 'example.ts', contents: 'const x = 1;' };
 * const hast = await workerAPI.renderFileToHast(file, {
 *   theme: 'github-dark',
 * });
 *
 * Render a diff
 * const oldFile = { name: 'example.ts', contents: 'const x = 1;' };
 * const newFile = { name: 'example.ts', contents: 'const x = 2;' };
 * const diffHast = await workerAPI.renderDiffToHast(oldFile, newFile, {
 *   theme: 'github-dark',
 * });
 *
 * Clean up when done
 * workerAPI.terminate();
 *
 */

export * from './ShikiPoolManager';
export * from './WorkerPool';
export * from './types';
