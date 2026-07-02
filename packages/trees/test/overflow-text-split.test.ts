import { describe, expect, test } from 'bun:test';
import { h, render } from 'preact';

import {
  MiddleTruncate,
  splitCenter,
  splitExtension,
} from '../src/components/OverflowText';
import { installDom } from './helpers/dom';

// A split boundary that lands adjacent to whitespace causes the boundary space
// to collapse under `white-space: nowrap`, making the name visually lose its
// space (issue #744 — "Hello world" rendered as "Helloworld"). These tests
// assert the boundary is never adjacent to whitespace when a clean boundary
// exists, so the space stays interior to one rendered segment.
function boundaryIsWhitespaceFree([first, second]: [string, string]): boolean {
  const before = first[first.length - 1];
  const after = second[0];
  const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
  return !isSpace(before) && !isSpace(after);
}

describe('splitExtension whitespace boundary (issue #744)', () => {
  test('dotless name with a mid-string space does not split on the space', () => {
    // "Hello world" is 11 chars; the naive center split is index 6, which
    // leaves "Hello " with a trailing space that collapses on render.
    const result = splitExtension('Hello world');
    expect(result.join('')).toBe('Hello world');
    expect(boundaryIsWhitespaceFree(result)).toBe(true);
  });

  test('shorter dotless name with a space keeps the space interior', () => {
    const result = splitExtension('my file');
    expect(result.join('')).toBe('my file');
    expect(boundaryIsWhitespaceFree(result)).toBe(true);
  });

  test('multi-word dotless name avoids a whitespace boundary', () => {
    const result = splitExtension('Hello world wide web');
    expect(result.join('')).toBe('Hello world wide web');
    expect(boundaryIsWhitespaceFree(result)).toBe(true);
  });

  test('name with a dot still splits at the extension', () => {
    // Splits after the final dot, and the dot boundary is not whitespace.
    const result = splitExtension('my file.txt');
    expect(result).toEqual(['my file.', 'txt']);
    expect(boundaryIsWhitespaceFree(result)).toBe(true);
  });

  test('name with multiple dots splits at the last dot', () => {
    expect(splitExtension('archive.tar.gz')).toEqual(['archive.tar.', 'gz']);
  });

  test('round-trips the original contents for spaced names', () => {
    for (const name of ['Hello world', 'a quick brown fox', 'one two']) {
      expect(splitExtension(name).join('')).toBe(name);
    }
  });
});

describe('splitCenter whitespace boundary (issue #744)', () => {
  test('dotless spaced name does not split on the space', () => {
    const result = splitCenter('Hello world');
    expect(result.join('')).toBe('Hello world');
    expect(boundaryIsWhitespaceFree(result)).toBe(true);
  });

  test('name without spaces still splits near the center', () => {
    expect(splitCenter('abcdef')).toEqual(['abc', 'def']);
  });
});

describe('MiddleTruncate rendered shape', () => {
  test('splits extension names into two native truncation containers without duplicate marker content', () => {
    const { cleanup, dom } = installDom();
    const mount = dom.window.document.createElement('div');
    try {
      render(
        h(MiddleTruncate, {
          children: 'archive.tar.gz',
          minimumLength: 5,
          split: 'extension',
        }),
        mount
      );

      const group = mount.querySelector(
        '[data-truncate-group-container="middle"]'
      );
      if (!(group instanceof dom.window.HTMLElement)) {
        throw new Error('expected middle truncation group');
      }

      const directContainers = Array.from(group.children).filter((child) =>
        child.hasAttribute('data-truncate-container')
      );

      expect(directContainers).toHaveLength(2);
      expect(group.children).toHaveLength(2);
      expect(
        directContainers.map((container) =>
          container.getAttribute('data-truncate-container')
        )
      ).toEqual(['truncate', 'fruncate']);
      expect(
        directContainers.map((container) =>
          container.getAttribute('data-truncate-segment-priority')
        )
      ).toEqual(['2', '1']);
      expect(
        directContainers.map((container) => container.textContent)
      ).toEqual(['archive.tar.', 'gz']);
      expect(group.textContent).toBe('archive.tar.gz');
      expect(
        group.querySelectorAll(
          '[data-truncate-marker], [data-truncate-grid], [data-truncate-fill]'
        )
      ).toHaveLength(0);
    } finally {
      render(null, mount);
      cleanup();
    }
  });
});
