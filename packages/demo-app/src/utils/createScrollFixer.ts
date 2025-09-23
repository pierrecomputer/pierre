import type { CodeRenderer } from '@pierre/diff-ui';

export function createScrollFixer() {
  let isScrolledToBottom = false;
  return {
    onPreRender(instance: CodeRenderer) {
      const { pre } = instance;
      if (pre == null) {
        throw new Error('onPostRender: pre wrapper does not exist');
      }
      isScrolledToBottom =
        pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 1;
    },
    onPostRender(instance: CodeRenderer) {
      const { pre } = instance;
      if (pre == null) {
        throw new Error('onPostRender: pre wrapper does not exist');
      }
      if (isScrolledToBottom) {
        pre.scrollTop = pre.scrollHeight;
      }
    },
  };
}
