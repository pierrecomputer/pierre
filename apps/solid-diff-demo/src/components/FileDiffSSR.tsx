import { FileDiff } from "@pierre/precision-diffs";
import type { DiffLineAnnotation } from "@pierre/precision-diffs";
import { createSignal, onMount, onCleanup, For } from "solid-js";
import { isServer, render } from "solid-js/web";

interface FileDiffSSRProps {
  preloadedHTML: string;
  oldFile: any;
  newFile: any;
  options: any;
  annotations: any[];
  renderAnnotation?: (annotation: DiffLineAnnotation<any>) => any;
}

export function FileDiffSSR(props: FileDiffSSRProps) {
  let fileDiffRef: HTMLElement | undefined;
  let fileDiffInstance: FileDiff<any> | undefined;
  const [isHydrated, setIsHydrated] = createSignal(false);
  const cleanupFunctions: Array<() => void> = [];

  onMount(async () => {
    if (isServer || !fileDiffRef) return;

    // Create FileDiff instance for the already-rendered content
    fileDiffInstance = new FileDiff(props.options ?? {}, true);
    fileDiffInstance.fileContainer = fileDiffRef as HTMLElement;

    // Find and hydrate annotation slots
    if (props.annotations.length > 0 && props.renderAnnotation) {
      for (const annotation of props.annotations) {
        const slotName = `annotation-${annotation.side}-${annotation.lineNumber}`;
        const slotElement = fileDiffRef.querySelector(
          `[slot="${slotName}"]`
        ) as HTMLElement;

        if (slotElement) {
          // Clear the static server-rendered content
          slotElement.innerHTML = "";

          // Render the interactive SolidJS component into this slot
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
    fileDiffInstance?.cleanUp();
    cleanupFunctions.forEach((dispose) => dispose());
  });

  return (
    <div>
      <file-diff
        ref={fileDiffRef}
        id="ssr-diff"
        class="overflow-hidden rounded-lg border border-gray-700"
      >
        {isServer && (
          <>
            <template shadowrootmode="open">
              {/* @ts-ignore */}
              <div innerHTML={props.preloadedHTML} />
            </template>
            {/* Render static annotation slots on server */}
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

      <p style={{ "margin-top": "10px", "font-size": "14px", color: "#888" }}>
        {isHydrated() ? "✅ SSR Hydrated" : "⏳ Loading..."}
      </p>
    </div>
  );
}
