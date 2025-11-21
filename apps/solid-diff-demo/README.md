# Precision Diffs × SolidStart SSR Demo

This demo proves that **`@pierre/precision-diffs`** works seamlessly with **SolidStart's server-side rendering (SSR)**, including support for interactive SolidJS components inside annotation slots within shadow DOM.

## What This Demonstrates

✅ **Server-side rendering** of file diffs using declarative shadow DOM
✅ **Client-side hydration** without content duplication
✅ **SolidJS reactivity** (signals, effects) inside annotation slots
✅ **Event handling** in shadow DOM contexts (critical gotcha documented)
✅ **Zero-JavaScript fallback** - the diff renders even with JS disabled

## Why This Matters

Precision-diffs uses web components with shadow DOM, which can be tricky to integrate with SSR frameworks. This demo solves the key challenges:

1. **Avoiding hydration mismatches** between server and client
2. **Enabling framework reactivity** inside shadow DOM slots
3. **Handling event delegation** with shadow boundaries
4. **Maintaining performance** by avoiding duplicate renders

## Quick Start

```bash
# Install dependencies
bun install

# Run development server
bun run dev

# Build for production
bun run build

# Start production server
bun run start
```

Open [http://localhost:3000](http://localhost:3000) and try:

- Viewing the SSR-rendered diff (works with JavaScript disabled!)
- Clicking the counter button in the annotation (proves SolidJS reactivity works)
- Selecting lines in the diff (FileDiff event handlers work)

## Project Structure

```
src/
├── components/
│   └── FileDiffSSR.tsx        # SSR wrapper component (main integration logic)
├── lib/
│   └── preload-diff.ts        # Server function for preloading diffs
├── routes/
│   └── index.tsx              # Demo page with annotation component
├── diff-data.ts               # Sample file contents for diff
├── custom-elements.d.ts       # TypeScript declarations for <file-diff>
├── app.tsx                    # Root component
├── entry-client.tsx           # Client hydration entry
└── entry-server.tsx           # SSR entry
```

## Key Concepts

### Declarative Shadow DOM

Precision-diffs uses the **declarative shadow DOM** (DSD) feature for SSR:

```tsx
<template shadowrootmode="open">
  <div innerHTML={prerenderedHTML} />
</template>
```

Browsers automatically parse this and create a shadow root before JavaScript runs, enabling true SSR for web components.

### SSR Hydration Flow

1. **Server**: Calls `preloadMultiFileDiff()` to generate HTML with DSD
2. **Server**: Renders static annotation content into slots
3. **Browser**: Parses DSD and creates shadow root (no JS needed yet)
4. **Client**: Creates FileDiff instance and connects to existing DOM
5. **Client**: Clears annotation slots and mounts interactive SolidJS components

**Critical**: We don't call `FileDiff.hydrate()` because that would re-render content. Instead, we just set `fileDiffInstance.fileContainer` to attach event handlers to the existing DOM.

### Event Handling in Shadow DOM

**IMPORTANT GOTCHA**: SolidJS's default event handling doesn't work in shadow DOM.

```tsx
// ❌ WRONG - onClick uses event delegation (doesn't work in shadow DOM)
<button onClick={() => setCount(count() + 1)}>
  {count()}
</button>

// ✅ CORRECT - on:click uses native event binding (works in shadow DOM)
<button on:click={() => setCount(count() + 1)}>
  {count()}
</button>
```

**Why?** SolidJS's `onClick` uses event delegation - it attaches a single listener to `document` and relies on event bubbling. Events fired inside shadow DOM don't bubble past the shadow boundary, so the document-level listener never receives them.

**Solution:** Use the `on:` prefix (e.g., `on:click`, `on:input`) to attach native event listeners directly to elements.

### Annotation Slots

Annotations are rendered into **named slots** that project content into the shadow DOM:

```tsx
// Server renders static content
<div slot="annotation-additions-8">
  <ErrorAnnotation message="Error on this line" />
</div>;

// Client clears and mounts interactive component
slotElement.innerHTML = '';
const dispose = render(() => <ErrorAnnotation />, slotElement);
```

This two-phase approach avoids hydration mismatches while enabling full SolidJS reactivity.

## Integration Guide

### Step 1: Install Precision Diffs

```bash
bun add @pierre/precision-diffs
```

### Step 2: Add TypeScript Declarations

Create `src/custom-elements.d.ts`:

```typescript
declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'file-diff': HTMLAttributes<HTMLElement>;
    }
  }
}

export {};
```

### Step 3: Create Server Function

Create a cached server function to preload diffs (e.g., `src/lib/preload-diff.ts`):

```typescript
'use server';

import { preloadMultiFileDiff } from '@pierre/precision-diffs/ssr';
import { cache } from '@solidjs/router';

export const getPreloadedDiff = cache(async (oldFile, newFile) => {
  'use server';

  return await preloadMultiFileDiff({
    oldFile,
    newFile,
    options: {
      theme: 'pierre-dark',
      diffStyle: 'split',
    },
    annotations: [], // Optional annotations
  });
}, 'preloaded-diff');
```

### Step 4: Create SSR Wrapper Component

Copy `src/components/FileDiffSSR.tsx` to your project. This component handles:

- Server-side rendering with declarative shadow DOM
- Client-side hydration without re-rendering
- Annotation slot hydration with SolidJS components

### Step 5: Use in Your Routes

```tsx
import { createAsync } from '@solidjs/router';
import { FileDiffSSR } from '~/components/FileDiffSSR';
import { getPreloadedDiff } from '~/lib/preload-diff';

export default function DiffPage() {
  const preloadedDiff = createAsync(() => getPreloadedDiff());

  return (
    <Show when={preloadedDiff()}>
      {(diff) => (
        <FileDiffSSR
          preloadedHTML={diff().prerenderedHTML}
          oldFile={diff().oldFile}
          newFile={diff().newFile}
          options={diff().options}
          annotations={diff().annotations}
          renderAnnotation={(annotation) => (
            <YourAnnotationComponent {...annotation} />
          )}
        />
      )}
    </Show>
  );
}
```

### Step 6: Create Annotation Components

**Remember to use `on:click` instead of `onClick`:**

```tsx
function YourAnnotationComponent({ metadata }) {
  const [count, setCount] = createSignal(0);

  return (
    <div>
      {metadata.message}
      {/* Use on:click, not onClick! */}
      <button on:click={() => setCount(count() + 1)}>{count()}</button>
    </div>
  );
}
```

## Common Pitfalls

### 1. Using onClick Instead of on:click

**Problem:** Buttons/interactive elements in annotations don't respond to clicks.

**Solution:** Always use `on:click`, `on:input`, etc. (native events) instead of `onClick`, `onInput` (delegated events) inside annotation components.

### 2. Calling FileDiff.hydrate() on Client

**Problem:** Content appears twice after hydration.

**Solution:** Don't call `hydrate()`. Just create the instance and set `fileContainer`:

```typescript
// ✅ CORRECT
fileDiffInstance = new FileDiff(options, true);
fileDiffInstance.fileContainer = element;

// ❌ WRONG (causes duplicate content)
await fileDiffInstance.hydrate({ oldFile, newFile, options });
```

### 3. Hydrating Annotation Slots Normally

**Problem:** `Error: Hydration Mismatch` when trying to hydrate annotation slots.

**Solution:** Clear slots and use `render()` to mount fresh components:

```typescript
slotElement.innerHTML = ""; // Clear static content
const dispose = render(() => <Component />, slotElement);
```

### 4. Forgetting TypeScript Declarations

**Problem:** TypeScript errors when using `<file-diff>` in TSX.

**Solution:** Create `custom-elements.d.ts` with the declaration (see Step 2).

## Troubleshooting

### Diff doesn't render with JavaScript disabled

- Check that declarative shadow DOM is enabled (it's supported in all modern browsers)
- Verify `preloadedHTML` contains the full diff content
- Ensure `<template shadowrootmode="open">` is present in server-rendered HTML

### Annotations don't appear

- Verify annotation slot names match: `annotation-${side}-${lineNumber}`
- Check that `renderAnnotation` prop is passed to `FileDiffSSR`
- Confirm annotations array is not empty

### Events don't fire in annotations

- **Most common issue:** Using `onClick` instead of `on:click`
- Use browser DevTools to verify event listeners are attached
- Check that components are being mounted (add temporary console.log)

### Content flickers or duplicates

- Don't call `FileDiff.hydrate()` - just set `fileContainer`
- Ensure conditional rendering with `{isServer && ...}` is correct
- Verify `cleanUp()` is called in `onCleanup()`

## Performance Notes

- **Server**: Diff generation happens once and is cached with SolidStart's `cache()`
- **Client**: No re-rendering during hydration - existing DOM is reused
- **Bundle size**: Precision-diffs includes syntax highlighting; consider code splitting for large apps

## Browser Support

- Declarative Shadow DOM: Chrome 90+, Edge 91+, Safari 16.4+, Firefox 123+
- For older browsers, precision-diffs automatically falls back to client-side rendering

## Learn More

- [Precision Diffs Documentation](https://precision-diffs.pierre.io)
- [SolidStart Documentation](https://start.solidjs.com)
- [Declarative Shadow DOM](https://developer.chrome.com/docs/css-ui/declarative-shadow-dom)
- [Shadow DOM Event Model](https://javascript.info/shadow-dom-events)

## License

MIT
