import { DEFAULT_THEMES } from '@pierre/diffs';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const TOKEN_HOVER_EXAMPLE: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'styles.css',
    contents: `.card-grid {
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  gap: 1rem;
  max-width: 960px;
  margin-inline: auto;
}

.card-grid .card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background-color: var(--color-surface);
  border-radius: 8px;
  border: 1px solid transparent;
}

.card-grid .card:hover {
  border: 1px solid var(--color-border);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.08);
}

@media (min-width: 640px) {
  .card-grid {
    flex-direction: row;
  }
}

@media (min-width: 1024px) {
  .card-grid {
    max-width: 1200px;
  }
}
`,
  },
  newFile: {
    name: 'styles.css',
    contents: `@layer components {
  .card-grid {
    container: cards / inline-size;
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    max-width: 960px;
    margin-inline: auto;
    margin-trim: in-flow;
  }

  .card-grid .card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background-color: var(--color-surface);
    border-radius: 8px;
    border: 1px solid transparent;

    &:hover {
      border: 1px solid var(--color-border);
      box-shadow: 0 2px 8px rgb(0 0 0 / 0.08);
    }

    &:focus-visible {
      outline: 2px solid var(--color-accent);
    }
  }

  @container cards (min-width: 640px) {
    .card-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @container cards (min-width: 1024px) {
    .card-grid {
      grid-template-columns: repeat(3, 1fr);
      max-width: 1200px;
    }
  }
}
`,
  },
  options: {
    theme: DEFAULT_THEMES,
    themeType: 'dark',
    diffStyle: 'split',
    useTokenTransformer: true,
    unsafeCSS: CustomScrollbarCSS,
  },
};
