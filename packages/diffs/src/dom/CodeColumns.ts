/**
 * The code columns a component renders, by role, and their horizontal scroll
 * offsets. The offsets are kept from the columns' scroll events, so reading
 * them never touches the DOM. The columns scroll together, but a narrower
 * column clamps lower, so the widest one's offset is the component's.
 */
export class CodeColumns<Role extends string> {
  readonly #elements = new Map<Role, HTMLElement>();
  readonly #scrollLefts = new Map<HTMLElement, number>();

  get(role: Role): HTMLElement | undefined {
    return this.#elements.get(role);
  }

  /**
   * Installs a role's column, moving the scroll listener from the column it
   * replaces. A column already on screen is read once; a new one starts at
   * zero.
   */
  set(role: Role, column: HTMLElement | undefined): void {
    const previous = this.#elements.get(role);
    if (previous === column) {
      return;
    }
    if (previous != null) {
      previous.removeEventListener('scroll', this.#handleScroll);
      this.#scrollLefts.delete(previous);
      this.#elements.delete(role);
    }
    if (column != null) {
      column.addEventListener('scroll', this.#handleScroll, { passive: true });
      this.#scrollLefts.set(column, column.isConnected ? column.scrollLeft : 0);
      this.#elements.set(role, column);
    }
  }

  /** Forgets every column and stops listening to it. */
  cleanUp(): void {
    for (const role of [...this.#elements.keys()]) {
      this.set(role, undefined);
    }
  }

  /** The widest column's horizontal scroll offset. */
  get scrollLeft(): number {
    let scrollLeft = 0;
    for (const columnScrollLeft of this.#scrollLefts.values()) {
      scrollLeft = Math.max(scrollLeft, columnScrollLeft);
    }
    return scrollLeft;
  }

  /**
   * Scrolls every column to `position` and keeps where each one landed: a
   * column clamps a position past its content, and no scroll event follows
   * when it did not move.
   */
  setScrollLeft(position: number): void {
    for (const column of this.#scrollLefts.keys()) {
      column.scrollLeft = position;
      this.#scrollLefts.set(column, column.scrollLeft);
    }
  }

  #handleScroll = (event: Event): void => {
    const { currentTarget } = event;
    if (currentTarget instanceof HTMLElement) {
      this.#scrollLefts.set(currentTarget, currentTarget.scrollLeft);
    }
  };
}
