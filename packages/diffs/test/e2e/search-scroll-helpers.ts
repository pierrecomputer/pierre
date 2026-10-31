import { expect, type JSHandle, type Page } from '@playwright/test';

interface HorizontalScrollProbe {
  calls: {
    behavior: ScrollBehavior | undefined;
    immediate: boolean;
    verticalUnchanged: boolean;
  }[];
  restore(): void;
}

export async function expectCurrentMatchHorizontallyVisible(
  page: Page
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const range = [
          ...(CSS.highlights.get('diffs-search-current') ?? []),
        ][0] as Range | undefined;
        const code =
          range?.startContainer.parentElement?.closest<HTMLElement>(
            '[data-code]'
          );
        if (range == null || code == null) return false;
        const row =
          range.startContainer.parentElement!.closest<HTMLElement>(
            '[data-line]'
          )!;
        const current = (
          window.__codeView as unknown as
            | {
                searchState: {
                  current?: {
                    lineNumber: number;
                    startCharacter: number;
                    side?: string;
                  };
                };
              }
            | undefined
        )?.searchState.current;
        if (current != null) {
          const prefix = document.createRange();
          prefix.selectNodeContents(row);
          prefix.setEnd(range.startContainer, range.startOffset);
          const side =
            row.dataset.lineType === 'change-deletion' ||
            row.closest('[data-deletions]') != null
              ? 'deletions'
              : 'additions';
          if (
            Number(row.dataset.line) !== current.lineNumber ||
            prefix.toString().length !== current.startCharacter ||
            (current.side != null && current.side !== side)
          )
            return false;
        }
        const rect = range.getBoundingClientRect();
        const viewport = code.getBoundingClientRect();
        const gutter = code.querySelector<HTMLElement>(
          ':scope > [data-gutter]'
        );
        const left = Math.max(
          viewport.left + code.clientLeft,
          gutter?.getBoundingClientRect().right ?? viewport.left
        );
        return (
          rect.width > 0 &&
          rect.left >= left - 1 &&
          rect.right <= viewport.left + code.clientLeft + code.clientWidth + 1
        );
      })
    )
    .toBe(true);
}

// Record the current match's code-column scrolls at call time, so an eventual
// smooth-scroll arrival cannot pass as an immediate horizontal correction.
export async function trackHorizontalSearchScrolls(
  page: Page
): Promise<JSHandle<HorizontalScrollProbe>> {
  return page.evaluateHandle(() => {
    const calls: {
      behavior: ScrollBehavior | undefined;
      immediate: boolean;
      verticalUnchanged: boolean;
    }[] = [];
    const original = HTMLElement.prototype.scrollTo;
    for (const host of document.querySelectorAll('diffs-container')) {
      for (const code of host.shadowRoot!.querySelectorAll<HTMLElement>(
        '[data-code]'
      )) {
        code.style.scrollBehavior = 'smooth';
      }
    }
    HTMLElement.prototype.scrollTo = function (
      options?: ScrollToOptions | number,
      y?: number
    ) {
      const top = this.scrollTop;
      Reflect.apply(
        original,
        this,
        typeof options === 'number' ? [options, y ?? 0] : [options]
      );
      const range = [
        ...(CSS.highlights.get('diffs-search-current') ?? []),
      ][0] as Range | undefined;
      if (
        typeof options !== 'object' ||
        options.left == null ||
        this !== range?.startContainer.parentElement?.closest('[data-code]')
      )
        return;
      const target = Math.min(
        this.scrollWidth - this.clientWidth,
        Math.max(0, options.left)
      );
      calls.push({
        behavior: options.behavior,
        immediate: Math.abs(this.scrollLeft - target) < 1,
        verticalUnchanged: top === this.scrollTop,
      });
    };
    return {
      calls,
      restore: (): void => {
        HTMLElement.prototype.scrollTo = original;
      },
    };
  });
}

export async function getCurrentMatchLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const range = [...(CSS.highlights.get('diffs-search-current') ?? [])][0] as
      | Range
      | undefined;
    return Number(
      range?.startContainer.parentElement
        ?.closest('[data-line]')
        ?.getAttribute('data-line')
    );
  });
}

export async function resetCurrentMatchHorizontalScroll(
  page: Page
): Promise<void> {
  await page.evaluate(() => {
    const range = [...CSS.highlights.get('diffs-search-current')!][0] as Range;
    range.startContainer
      .parentElement!.closest<HTMLElement>('[data-code]')!
      .scrollTo({ left: 0, behavior: 'instant' });
  });
}
