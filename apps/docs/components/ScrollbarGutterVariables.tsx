'use client';

import { useLayoutEffect } from 'react';

import { detectGutterSize } from '@/lib/gutterDetector';

const CODE_VIEW_SCROLLBAR_CLASS = 'cv-scrollbar';
const CODE_VIEW_SCROLLBAR_GUTTER_VERTICAL_VARIABLE = '--cv-gutter-vertical';
const CODE_VIEW_SCROLLBAR_GUTTER_HORIZONTAL_VARIABLE = '--cv-gutter-horizontal';

export function ScrollbarGutterVariables() {
  useLayoutEffect(() => {
    const { vertical, horizontal } = detectGutterSize(
      CODE_VIEW_SCROLLBAR_CLASS
    );
    const { documentElement: root } = document;
    root.style.setProperty(
      CODE_VIEW_SCROLLBAR_GUTTER_VERTICAL_VARIABLE,
      `${vertical}px`
    );
    root.style.setProperty(
      CODE_VIEW_SCROLLBAR_GUTTER_HORIZONTAL_VARIABLE,
      `${horizontal}px`
    );
  }, []);

  return null;
}
