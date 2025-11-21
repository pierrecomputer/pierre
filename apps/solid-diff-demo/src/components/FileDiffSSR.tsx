import { FileDiff } from '@pierre/precision-diffs';
import type { DiffLineAnnotation, FileContents } from '@pierre/precision-diffs';
import { For, type JSX, createSignal, onCleanup, onMount } from 'solid-js';
import { isServer, render } from 'solid-js/web';

/**
 * Props for the FileDiffSSR component.
 * @template T - The type of metadata attached to annotations
 */
interface FileDiffSSRProps<T = unknown> {
  /** Prerendered HTML from the server (with declarative shadow DOM) */
  preloadedHTML: string;
  /** Old file contents and name */
  oldFile: FileContents;
  /** New file contents and name */
  newFile: FileContents;
  /** Configuration options for the diff viewer (use 'any' as FileDiffOptions requires generic) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FileDiffOptions requires generic type parameter
  options: any;
  /** Array of annotations to render in the diff */
  annotations: DiffLineAnnotation<T>[];
  /** Function to render annotation components (should return SolidJS JSX) */
  renderAnnotation?: (annotation: DiffLineAnnotation<T>) => JSX.Element;
}

/**
 * FileDiffSSR - Server-side rendered file diff component for SolidStart.
 *
 * This component demonstrates how to integrate precision-diffs with SolidStart's SSR:
 * 1. Server renders static HTML with declarative shadow DOM using preloadMultiFileDiff()
 * 2. Client hydrates by connecting FileDiff instance to existing DOM (no re-render)
 * 3. Annotation slots are replaced with interactive SolidJS components on the client
 *
 * Key challenge solved: SolidJS reactivity inside shadow DOM annotation slots.
 * - Server renders static annotation content
 * - Client clears slots and mounts fresh SolidJS components using render()
 * - Native event binding (on:click) required instead of delegated events (onClick)
 *
 * @param props - Component props including prerendered HTML and annotation config
 * @returns JSX element containing the hydrated file diff
 */
export function FileDiffSSR(props: FileDiffSSRProps) {
  let fileDiffRef: HTMLElement | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FileDiff requires generic type parameter
  let fileDiffInstance: FileDiff<any> | undefined;
  const [isHydrated, setIsHydrated] = createSignal(false);
  const cleanupFunctions: Array<() => void> = [];

  onMount(() => {
    if (isServer || fileDiffRef == null) return;

    // Create FileDiff instance and connect to existing server-rendered DOM.
    // Don't call hydrate() - that would re-render content and cause duplication.
    // Instead, just set the fileContainer reference to attach event handlers.
    fileDiffInstance = new FileDiff(props.options ?? {}, true);
    // @ts-expect-error - fileContainer is private but needed for SSR hydration
    fileDiffInstance.fileContainer = fileDiffRef;

    // Hydrate annotation slots with interactive SolidJS components
    if (props.annotations.length > 0 && props.renderAnnotation != null) {
      for (const annotation of props.annotations) {
        const slotName = `annotation-${annotation.side}-${annotation.lineNumber}`;
        const slotElement = fileDiffRef.querySelector(
          `[slot="${slotName}"]`
        ) as HTMLElement;

        if (slotElement != null) {
          // Clear the static server-rendered content from the slot
          slotElement.innerHTML = '';

          // Mount a fresh SolidJS component into this slot using render().
          // This enables full SolidJS reactivity (signals, effects, etc.)
          const dispose = render(
            () => props.renderAnnotation!(annotation),
            slotElement
          );
          cleanupFunctions.push(dispose);
        }
      }
    }

    setIsHydrated(true);
  });

  onCleanup(() => {
    // Clean up FileDiff event handlers and dispose SolidJS components
    fileDiffInstance?.cleanUp();
    cleanupFunctions.forEach((dispose) => dispose());
  });

  return (
    <div>
      {/* Custom element that will contain the file diff */}
      <file-diff
        ref={fileDiffRef}
        id="ssr-diff"
        class="overflow-hidden rounded-lg border border-gray-700"
      >
        {/* Only render on server - client hydrates the existing content */}
        {isServer && (
          <>
            {/* Declarative Shadow DOM - browsers parse this and create a shadow root */}
            <template shadowrootmode="open">
              <div innerHTML={props.preloadedHTML} />
            </template>
            {/* Render static annotation slots on server.
                Client will clear these and mount interactive components. */}
            <For each={props.annotations}>
              {(annotation) => {
                const slotName = `annotation-${annotation.side}-${annotation.lineNumber}`;
                return (
                  <div slot={slotName}>
                    {props.renderAnnotation?.(annotation)}
                  </div>
                );
              }}
            </For>
          </>
        )}
      </file-diff>

      {/* Hydration status indicator */}
      <p style={{ 'margin-top': '10px', 'font-size': '14px', color: '#888' }}>
        {isHydrated() ? '✅ SSR Hydrated' : '⏳ Loading...'}
      </p>
    </div>
  );
}
