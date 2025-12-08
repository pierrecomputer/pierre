import type { DIFFS_TAG_NAME } from '@pierre/diffs';

/**
 * TypeScript declaration for the <file-diff> custom element.
 * This tells TypeScript that <file-diff> is a valid JSX element in SolidJS.
 * Required for using the diffs web component in .tsx files.
 */
declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      [DIFFS_TAG_NAME]: HTMLAttributes<HTMLElement>;
    }
  }
}

export {};
