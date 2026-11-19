'use client';

import type { CodeViewItem } from '@pierre/diffs';
import type { EditorOptions, EditorType } from '@pierre/diffs/edit';
import { CodeView, type CodeViewHandle, File } from '@pierre/diffs/react';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from 'react';

const SOURCE = `export function searchPanelFixture(value: string) {
  const target = value.trim();
  if (target === '') return 'empty target';
  return target.repeat(3);
}

const otherTarget = searchPanelFixture('target');
console.log(otherTarget);
`;

const CODE_VIEW_ITEMS: CodeViewItem<undefined>[] = [
  {
    id: 'search-panel-fixture',
    type: 'file',
    file: { name: 'search-panel.ts', contents: SOURCE },
  },
];

const SURFACE_STYLE: CSSProperties = {
  display: 'block',
  height: 190,
  overflow: 'auto',
};

function getPanelRoot(container: ParentNode): ShadowRoot | null {
  const panel = container.querySelector<HTMLElement>('[data-search-panel]');
  return panel?.shadowRoot ?? null;
}

function setSyntheticCount(container: ParentNode, count: string): void {
  let attempts = 0;
  const update = () => {
    const matches = getPanelRoot(container)?.querySelector('[data-matches]');
    if (matches != null) {
      matches.textContent = count;
      return;
    }
    attempts += 1;
    if (attempts < 60) {
      window.requestAnimationFrame(update);
    }
  };
  update();
}

function openEditorSearch(
  container: HTMLElement,
  mode: 'find' | 'replace',
  query: string,
  syntheticCount?: string
): void {
  let attempts = 0;
  const open = () => {
    const host = container.querySelector<HTMLElement>('diffs-container');
    const activeElement = host?.shadowRoot?.activeElement;
    const content =
      activeElement instanceof HTMLElement &&
      activeElement.matches('[data-content]')
        ? activeElement
        : host?.shadowRoot?.querySelector<HTMLElement>(
            '[data-additions] [data-content], [data-content]'
          );
    if (host == null || content == null) {
      attempts += 1;
      if (attempts < 60) {
        window.requestAnimationFrame(open);
      }
      return;
    }

    const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
    content.focus({ preventScroll: true });
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      code: 'KeyF',
      altKey: mode === 'replace',
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    content.dispatchEvent(event);
    if (!event.defaultPrevented) {
      attempts += 1;
      if (attempts < 60) {
        window.requestAnimationFrame(open);
      }
      return;
    }

    let populateAttempts = 0;
    const populate = () => {
      const input = getPanelRoot(
        host.shadowRoot!
      )?.querySelector<HTMLInputElement>('input[data-search]');
      if (input == null) {
        populateAttempts += 1;
        if (populateAttempts < 60) {
          window.requestAnimationFrame(populate);
        }
        return;
      }
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (syntheticCount != null) {
        setSyntheticCount(host.shadowRoot!, syntheticCount);
      }
    };
    populate();
  };
  open();
}

function Case({
  title,
  description,
  narrow = false,
  children,
}: {
  title: string;
  description: string;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-[var(--color-background)] p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <div
        className="rounded-lg border"
        style={{ maxWidth: narrow ? 360 : undefined }}
      >
        {children}
      </div>
    </section>
  );
}

function CodeViewCase({
  query,
  mode = 'find',
  syntheticCount,
  activeOptions = false,
}: {
  query: string;
  mode?: 'find' | 'replace';
  syntheticCount?: string;
  activeOptions?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewHandle<undefined, undefined>>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      viewerRef.current?.openSearch({ mode, query, scope: 'all' });
      if (syntheticCount != null && containerRef.current != null) {
        setSyntheticCount(containerRef.current, syntheticCount);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode, query, syntheticCount]);

  return (
    <div ref={containerRef}>
      <CodeView
        ref={viewerRef}
        initialItems={CODE_VIEW_ITEMS}
        options={{
          searchOptions: activeOptions
            ? { defaults: { caseSensitive: true, wholeWord: true } }
            : undefined,
        }}
        style={SURFACE_STYLE}
      />
    </div>
  );
}

function EditorCase({
  mode,
  query,
  syntheticCount,
}: {
  mode: 'find' | 'replace';
  query: string;
  syntheticCount?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorOptions = useMemo<
    EditorOptions<EditorType, undefined, undefined>
  >(
    () => ({
      onAttach(editor) {
        editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      },
    }),
    []
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (containerRef.current != null) {
        openEditorSearch(containerRef.current, mode, query, syntheticCount);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [mode, query, syntheticCount]);

  return (
    <div ref={containerRef}>
      <div className="flex justify-end border-b px-2 py-1">
        <button
          type="button"
          className="text-muted-foreground rounded px-2 py-1 text-xs hover:text-current"
          onClick={() => {
            if (containerRef.current != null) {
              openEditorSearch(
                containerRef.current,
                mode,
                query,
                syntheticCount
              );
            }
          }}
        >
          Open {mode === 'replace' ? 'find and replace' : 'find'}
        </button>
      </div>
      <File
        file={{ name: 'search-panel.ts', contents: SOURCE }}
        edit
        editorOptions={editorOptions}
        options={{ useTokenTransformer: true }}
        style={SURFACE_STYLE}
      />
    </div>
  );
}

export default function SearchPanelTestPage() {
  useEffect(() => {
    const timer = window.setTimeout(() => window.scrollTo(0, 0), 1000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-8 flex items-end justify-between gap-6">
        <div>
          <p className="text-muted-foreground mb-1 text-sm">
            One-off visual test route
          </p>
          <h1 className="text-2xl font-semibold">Search panel states</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
            Every panel is live and interactive. Reload to restore any panel
            after closing or editing it.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm font-medium"
          onClick={() => window.location.reload()}
        >
          Reset states
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Case
          title="CodeView · find"
          description="Normal selected-result count and default option states."
        >
          <CodeViewCase query="target" />
        </Case>

        <Case
          title="CodeView · no matches"
          description="The count area stays empty while navigation is disabled."
        >
          <CodeViewCase query="missing-result" />
        </Case>

        <Case
          title="CodeView · large count"
          description="Synthetic count for checking that only the input contracts."
        >
          <CodeViewCase
            query="target"
            syntheticCount="137/135,064"
            activeOptions
          />
        </Case>

        <Case
          title="Standalone File · find"
          description="The editor-owned panel used outside CodeView."
        >
          <EditorCase mode="find" query="target" />
        </Case>

        <Case
          title="Standalone File · find and replace"
          description="Expanded replacement row and action controls."
        >
          <EditorCase mode="replace" query="target" />
        </Case>

        <Case
          title="Standalone File · narrow replace"
          description="Responsive multi-row layout in the editor-owned context."
          narrow
        >
          <EditorCase mode="replace" query="target" />
        </Case>
      </div>
    </main>
  );
}
