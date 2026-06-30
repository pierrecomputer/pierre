'use client';

import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useEffect, useMemo, useRef } from 'react';

interface FindDemoProps {
  // Server-preloaded, highlighted File; hydrating from it avoids a highlight flash on load.
  prerenderedFile: PreloadedFileResult<undefined>;
}

// Custom element the File renders into; its shadow DOM is open, so we can reach in.
const DIFFS_TAG_NAME = 'diffs-container';

function detectMac(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

// Demo of the editor's find overlay. With no public API to open the search
// panel, we do what a reader would: dispatch Cmd/Ctrl-F on the content element
// (polling for it, since it attaches asynchronously after the File hydrates).
// We deliberately leave the input blank and never seed a query — seeding makes
// the editor scroll its first match into view, and that scroll bubbles up to
// the page, yanking the reader down to this (below-the-fold) demo on load.
// Opening an empty panel scrolls nothing.
export function FindDemo({ prerenderedFile }: FindDemoProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editor = useMemo(() => new Editor({}), []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper == null) {
      return;
    }

    const isMac = detectMac();
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;

    const getShadow = (): ShadowRoot | null => {
      const host = wrapper.querySelector<HTMLElement>(DIFFS_TAG_NAME);
      return host?.shadowRoot ?? null;
    };

    // Open the find panel via the real keyboard shortcut on the content element.
    // preventScroll keeps focusing the content from scrolling the page.
    const openPanel = (shadow: ShadowRoot) => {
      const content = shadow.querySelector<HTMLElement>('[data-content]');
      if (content == null) {
        return;
      }
      content.focus({ preventScroll: true });
      content.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          bubbles: true,
          cancelable: true,
          composed: true,
          metaKey: isMac,
          ctrlKey: !isMac,
        })
      );
    };

    // Poll until the content element has attached, open the panel once, then
    // stop. We leave the input blank, so nothing scrolls: opening an empty panel
    // reveals no match for the editor to scroll into view.
    const tick = () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      const shadow = getShadow();
      if (shadow != null) {
        if (shadow.querySelector('[data-search-panel]') != null) {
          return;
        }
        openPanel(shadow);
      }
      if (attempts < 120) {
        timer = window.setTimeout(tick, 50);
      }
    };

    // Defer until the demo nears the viewport so we only open the panel (and
    // focus its editor) as the reader approaches it, rather than on load.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          tick();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(wrapper);

    return () => {
      cancelled = true;
      observer.disconnect();
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [editor]);

  return (
    <div className="not-prose" ref={wrapperRef}>
      <EditorProvider editor={editor}>
        <File
          {...prerenderedFile}
          className="diff-container max-h-[420px] overflow-auto"
          contentEditable
        />
      </EditorProvider>
    </div>
  );
}
