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

  public clearSlotContent(slotName: string): void {
    const currentContent = this.#contentBySlot.get(slotName);
    if (currentContent == null) {
      return;
    }

    currentContent.remove();
    this.#contentBySlot.delete(slotName);
  }

  public setHost(host: HTMLElement | null): void {
    this.#host = host;
    if (host == null) {
      return;
    }

    this.#adoptExistingManagedContent(host);

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

  public setSlotHtml(slotName: string, html: string | null): void {
    const normalizedHtml = html?.trim() ?? '';
    if (normalizedHtml.length === 0) {
      this.setSlotContent(slotName, null);
      return;
    }

    const currentContent = this.#contentBySlot.get(slotName) ?? null;
    if (currentContent != null && currentContent.innerHTML === normalizedHtml) {
      this.#attachContent(slotName, currentContent);
      return;
    }

    const nextContent = document.createElement('div');
    nextContent.innerHTML = normalizedHtml;
    this.setSlotContent(slotName, nextContent);
  }

  #attachContent(slotName: string, content: HTMLElement): void {
    content.slot = slotName;
    content.dataset.pathStoreManagedSlot = slotName;
    if (this.#host != null && content.parentNode !== this.#host) {
      this.#host.appendChild(content);
    }
  }

  #adoptExistingManagedContent(host: HTMLElement): void {
    for (const element of Array.from(host.children)) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      const slotName = element.dataset.pathStoreManagedSlot;
      if (slotName == null || this.#contentBySlot.has(slotName)) {
        continue;
      }

      this.#contentBySlot.set(slotName, element);
    }
  }
}
