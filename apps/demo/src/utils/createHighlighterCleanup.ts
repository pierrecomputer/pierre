import { disposeHighlighter } from '@pierre/diffs';

let totalInstances = 0;
let completed = 0;

export function createHighlighterCleanup() {
  totalInstances++;
  return {
    onStreamClose() {
      completed++;
      if (completed >= totalInstances) {
        void disposeHighlighter();
      }
    },
  };
}
