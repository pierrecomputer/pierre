// Tracks the library-owned slotted nodes so header content can move with the
// host element without clobbering user-managed light-DOM children.
export class PathStoreTreesManagedSlotHost {
  #contentBySlot = new Map<string, HTMLElement>();
  #host: HTMLElement | null = null;

  public clearAll(): void {
    for (const content of this.#contentBySlot.values()) {
      content.remove();
    }
    this.#contentBySlot.clear();
  }

  public setHost(host: HTMLElement | null): void {
    this.#host = host;
    if (host == null) {
      return;
    }

    for (const [slotName, content] of this.#contentBySlot) {
      this.#attachContent(slotName, content);
    }
  }

  public setSlotContent(slotName: string, content: HTMLElement | null): void {
    const currentContent = this.#contentBySlot.get(slotName) ?? null;
    if (currentContent === content) {
      if (content != null) {
        this.#attachContent(slotName, content);
      }
      return;
    }

    currentContent?.remove();
    if (content == null) {
      this.#contentBySlot.delete(slotName);
      return;
    }

    this.#contentBySlot.set(slotName, content);
    this.#attachContent(slotName, content);
  }

  #attachContent(slotName: string, content: HTMLElement): void {
    content.slot = slotName;
    if (this.#host != null && content.parentNode !== this.#host) {
      this.#host.appendChild(content);
    }
  }
}
