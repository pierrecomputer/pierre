import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

/** Styled tokens only: most of a log is plain text. */
function styled(code: string): [string, string | null][] {
  return tokenKinds('log', code).filter(([, kind]) => kind !== null);
}

test('log: levels by severity, in any case and as bracketed letters', () => {
  expect(
    styled(
      'ERROR a\nError b\nFATAL c\nWARN d\nWarning e\nINFO f\nNotice g\nDEBUG h\nTRACE i\n'
    )
  ).toEqual([
    ['ERROR', 'diff.minus'],
    ['Error', 'diff.minus'],
    ['FATAL', 'diff.minus'],
    ['WARN', 'constant'],
    ['Warning', 'constant'],
    ['INFO', 'diff.plus'],
    ['Notice', 'diff.plus'],
    ['DEBUG', 'comment'],
    ['TRACE', 'comment'],
  ]);
  // lowercase levels need a mark beside them; prose stays plain
  expect(
    styled(
      '[error] x level=warn info: y |debug| no error here [E] [W] [I] [D] [X]'
    )
  ).toEqual([
    ['error', 'diff.minus'],
    ['warn', 'constant'],
    ['info', 'diff.plus'],
    ['debug', 'comment'],
    ['E', 'diff.minus'],
    ['W', 'constant'],
    ['I', 'diff.plus'],
    ['D', 'comment'],
  ]);
});

test('log: dates, times, numbers, and ids', () => {
  for (const value of [
    '2026-10-25T10:00:01.123Z',
    '2026-10-25',
    '10:00:01,123',
    '25/Oct/2026:10:00:01',
    '10.0.0.1:8080',
    '3.5ms',
    '0x1F',
    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    'a1b2c3d4e5',
  ]) {
    expect(styled(`at ${value}, ok`).slice(-1)).toEqual([[value, 'number']]);
  }
  // a capitalized month before a day is part of the date; prose is not
  expect(styled('Oct 25 10:00:01 host may 5 Mar x')).toEqual([
    ['Oct', 'number'],
    ['25', 'number'],
    ['10:00:01', 'number'],
    ['5', 'number'],
  ]);
  // words made of hex letters without a digit stay words
  expect(styled('deadbeef accede')).toEqual([]);
});

test('log: strings, URLs, exceptions, and stack frames', () => {
  expect(
    styled(
      `said "hi \\"there\\"" and 'quoted' but don't\nsee https://example.com/a?b=1&c=2. (https://x.io/y)\n`
    )
  ).toEqual([
    ['"hi', 'string'],
    ['\\"', 'string.escape'],
    ['there', 'string'],
    ['\\"', 'string.escape'],
    ['"', 'string'],
    ["'quoted'", 'string'],
    ['https://example.com/a?b=1&c=2', 'link_uri'],
    ['https://x.io/y', 'link_uri'],
  ]);
  const code =
    'java.lang.IllegalStateException: null value, true\n\tat com.example.App.run(App.java:17)\nTraceback (most recent call last):\nValueError: bad\n';
  expect(styled(code)).toEqual([
    ['IllegalStateException', 'type'],
    ['null', 'constant.builtin'],
    ['true', 'boolean'],
    ['at', 'keyword'],
    ['run', 'function'],
    ['17', 'number'],
    ['Traceback', 'diff.minus'],
    ['ValueError', 'type'],
  ]);
  assertLineFedParity('log', code);
});
