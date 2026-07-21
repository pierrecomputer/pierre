import { describe, expect, test } from 'bun:test';

import type { DiffLineAnnotation, LineAnnotation } from '../src/types';
import {
  isDiffAnnotation,
  isDiffAnnotationCollection,
  isFileAnnotation,
  isFileAnnotationCollection,
} from '../src/utils/annotationHelpers';

describe('annotation type guards', () => {
  test('identifies file annotations', () => {
    const annotation: LineAnnotation = { lineNumber: 1 };

    expect(isFileAnnotation(annotation)).toBe(true);
    expect(isDiffAnnotation(annotation)).toBe(false);
  });

  test('identifies diff annotations', () => {
    const annotation: DiffLineAnnotation = {
      side: 'additions',
      lineNumber: 1,
    };

    expect(isDiffAnnotation(annotation)).toBe(true);
    expect(isFileAnnotation(annotation)).toBe(false);
  });

  test('identifies file annotation collections', () => {
    const annotations: LineAnnotation[] = [{ lineNumber: 1 }];

    expect(isFileAnnotationCollection(annotations)).toBe(true);
    expect(isDiffAnnotationCollection(annotations)).toBe(false);
  });

  test('identifies diff annotation collections', () => {
    const annotations: DiffLineAnnotation[] = [
      { side: 'additions', lineNumber: 1 },
    ];

    expect(isDiffAnnotationCollection(annotations)).toBe(true);
    expect(isFileAnnotationCollection(annotations)).toBe(false);
  });

  test('accepts empty collections as either annotation shape', () => {
    const annotations: LineAnnotation[] | DiffLineAnnotation[] = [];

    expect(isDiffAnnotationCollection(annotations)).toBe(true);
    expect(isFileAnnotationCollection(annotations)).toBe(true);
  });
});
