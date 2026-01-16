export class ScrollSyncManager {
  isDeletionsScrolling: boolean = false;
  isAdditionsScrolling: boolean = false;
  timeoutId: NodeJS.Timeout = -1 as unknown as NodeJS.Timeout;
  codeDeletions: HTMLElement | undefined;
  codeAdditions: HTMLElement | undefined;
  private enabled = false;

  cleanUp(): void {
    if (!this.enabled) {
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
    clearTimeout(this.timeoutId);
    this.codeDeletions = undefined;
    this.codeAdditions = undefined;
    this.enabled = false;
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

    if (this.codeDeletions !== codeDeletions) {
      this.codeDeletions?.removeEventListener(
        'scroll',
        this.handleDeletionsScroll
      );
      this.codeDeletions = codeDeletions;
      codeDeletions.addEventListener('scroll', this.handleDeletionsScroll, {
        passive: true,
      });
    }
    if (this.codeAdditions !== codeAdditions) {
      this.codeAdditions?.removeEventListener(
        'scroll',
        this.handleAdditionsScroll
      );
      this.codeAdditions = codeAdditions;
      codeAdditions.addEventListener('scroll', this.handleAdditionsScroll, {
        passive: true,
      });
    }
    this.enabled = true;
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
