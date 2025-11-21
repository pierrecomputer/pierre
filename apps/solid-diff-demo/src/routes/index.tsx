import type { DiffLineAnnotation } from '@pierre/precision-diffs';
import { Title } from '@solidjs/meta';
import { createAsync } from '@solidjs/router';
import { Show, createSignal } from 'solid-js';
import { FileDiffSSR } from '~/components/FileDiffSSR';
import { getPreloadedDiff } from '~/lib/preload-diff';

interface AnnotationMetadata {
  message: string;
}

/**
 * Sample annotation component demonstrating SolidJS reactivity in shadow DOM.
 * This component uses createSignal() to manage a counter, proving that full
 * SolidJS reactivity works inside precision-diffs annotation slots.
 *
 * IMPORTANT: Must use on:click (native events) instead of onClick (delegated events)
 * because delegated events don't work with shadow DOM boundaries.
 */
function ErrorAnnotation({ message }: { message: string }) {
  const [clickCount, setClickCount] = createSignal(0);

  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '6px',
        'background-color': '#ef4444',
        color: 'white',
        padding: '0 8px',
        'font-size': '12px',
        'line-height': '20px',
      }}
    >
      <span>⚠️</span>
      {message}
      <button
        // Use on:click (native event) instead of onClick (delegated event)
        // because delegated events don't work with shadow DOM - events don't
        // bubble past the shadow boundary to reach document-level listeners
        on:click={() => setClickCount(clickCount() + 1)}
        style={{
          'background-color': '#fbbf24',
          color: '#451a03',
          padding: '0 8px',
          cursor: 'pointer',
          border: 'none',
          'user-select': 'none',
        }}
      >
        {clickCount()}
      </button>
    </div>
  );
}

export default function Home() {
  const [count, setCount] = createSignal(0);
  const preloadedDiff = createAsync(() => getPreloadedDiff());

  const renderAnnotation = (
    annotation: DiffLineAnnotation<AnnotationMetadata>
  ) => {
    return <ErrorAnnotation message={annotation.metadata.message} />;
  };

  return (
    <main style={{ padding: '20px', 'max-width': '1200px', margin: '0 auto' }}>
      <Title>SolidStart + Precision Diffs SSR Demo</Title>
      <h1 style={{ 'margin-bottom': '10px' }}>
        SolidStart + Precision Diffs SSR Demo
      </h1>
      <p style={{ 'margin-bottom': '20px' }}>
        This entire page is server-rendered with SolidStart. Try disabling
        JavaScript!
      </p>

      <div style={{ 'margin-bottom': '30px' }}>
        <button
          onClick={() => setCount(count() + 1)}
          style={{
            padding: '8px 16px',
            'background-color': '#3b82f6',
            color: 'white',
            border: 'none',
            'border-radius': '4px',
            cursor: 'pointer',
          }}
        >
          Count: {count()}
        </button>
        <span style={{ 'margin-left': '10px', color: '#888' }}>
          (Interactive after hydration)
        </span>
      </div>

      <h2 style={{ 'margin-bottom': '10px', 'margin-top': '40px' }}>
        SSR File Diff with Annotation
      </h2>
      <p
        style={{
          'margin-bottom': '10px',
          'font-size': '14px',
          color: '#888',
        }}
      >
        Pre-rendered on server with declarative shadow DOM. The annotation
        contains a SolidJS counter that hydrates!
      </p>

      <Show when={preloadedDiff()}>
        {(diff) => (
          <FileDiffSSR
            preloadedHTML={diff().prerenderedHTML}
            oldFile={diff().oldFile}
            newFile={diff().newFile}
            options={diff().options}
            annotations={diff().annotations ?? []}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Type cast needed for generic compatibility
            renderAnnotation={renderAnnotation as any}
          />
        )}
      </Show>
    </main>
  );
}
