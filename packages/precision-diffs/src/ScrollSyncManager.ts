export class ScrollSyncManager {
  isDeletionsScrolling: boolean = false;
  isAdditionsScrolling: boolean = false;
  timeoutId: NodeJS.Timeout = -1 as unknown as NodeJS.Timeout;
  codeDeletions: HTMLElement | undefined;
  codeAdditions: HTMLElement | undefined;

  cleanUp(): void {
    this.codeDeletions?.removeEventListener(
      'scroll',
      this.handleDeletionsScroll
    );
    this.codeAdditions?.removeEventListener(
      'scroll',
      this.handleAdditionsScroll
    );
    clearTimeout(this.timeoutId);
    this.codeDeletions = undefined;
    this.codeAdditions = undefined;
  }

  setup(
    pre: HTMLPreElement,
    codeDeletions?: HTMLElement,
    codeAdditions?: HTMLElement
  ): void {
    // If no code elements were provided, lets try to find them in
    // the pre element
    if (codeDeletions == null || codeAdditions == null) {
      for (const element of pre.children ?? []) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }
        if ('deletions' in element.dataset) {
          codeDeletions = element;
        } else if ('additions' in element.dataset) {
          codeAdditions = element;
        }
      }
    }
    if (codeAdditions == null || codeDeletions == null) {
      this.cleanUp();
      return;
    }
    this.codeDeletions?.removeEventListener(
      'scroll',
      this.handleDeletionsScroll
    );
    this.codeAdditions?.removeEventListener(
      'scroll',
      this.handleAdditionsScroll
    );
    this.codeDeletions = codeDeletions;
    this.codeAdditions = codeAdditions;
    codeDeletions.addEventListener('scroll', this.handleDeletionsScroll, {
      passive: true,
    });
    codeAdditions.addEventListener('scroll', this.handleAdditionsScroll, {
      passive: true,
    });
  }

  private handleDeletionsScroll = () => {
    if (this.isAdditionsScrolling) {
      return;
    }
    this.isDeletionsScrolling = true;
    clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => {
      this.isDeletionsScrolling = false;
    }, 300);
    this.codeAdditions?.scrollTo({
      left: this.codeDeletions?.scrollLeft,
    });
  };

  private handleAdditionsScroll = () => {
    if (this.isDeletionsScrolling) {
      return;
    }
    this.isAdditionsScrolling = true;
    clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => {
      this.isAdditionsScrolling = false;
    }, 300);
    this.codeDeletions?.scrollTo({
      left: this.codeAdditions?.scrollLeft,
    });
  };
}
