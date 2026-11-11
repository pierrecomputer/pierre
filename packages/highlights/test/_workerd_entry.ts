// Bundled by modular_test.ts with the `workerd` export condition.
import { createHighlighter } from '@pierre/highlights';
import { langs } from '@pierre/highlights/langs';
import typescript from '@pierre/highlights/langs/typescript';

export const highlighter: ReturnType<typeof createHighlighter> =
  createHighlighter({ langs: [...langs, typescript], themes: [] });
