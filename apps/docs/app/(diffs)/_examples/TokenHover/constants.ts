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
  padding: 2rem 1.5rem;
  max-width: 960px;
  margin: 0 auto;
}

.card-grid .card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background-color: var(--color-surface);
  border-radius: 8px;
  border: 1px solid transparent;
  transition: box-shadow 0.2s, border-color 0.2s;
  cursor: pointer;
}

.card-grid .card h3 {
  font-size: 1rem;
  line-height: 1.4;
  margin: 0;
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
    padding-block: 2rem;
    padding-inline: 1.5rem;
    max-width: 960px;
    margin: 0 auto;
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
    transition: box-shadow 0.2s, border-color 0.2s;
    cursor: pointer;

    &:hover {
      border: 1px solid var(--color-border);
      box-shadow: 0 2px 8px rgb(0 0 0 / 0.08);
    }

    &:focus-visible {
      outline: 2px solid var(--color-accent);
    }

    h3 {
      font-size: 1rem;
      line-height: 1.4;
      margin: 0;
      text-wrap: balance;
      text-box-trim: trim-start;
      text-box-edge: cap alphabetic;
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
