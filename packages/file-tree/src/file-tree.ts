import type { CSSResult, TemplateResult } from 'lit';
import { LitElement, css, html } from 'lit';
import { property } from 'lit/decorators.js';

export interface File {
  name: string;
  children?: File[];
}

export class FileTree extends LitElement {
  static override styles: CSSResult = css`
    :host {
      display: block;
    }
    ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    li {
      cursor: pointer;
    }
  `;

  @property({ type: Array }) files: File[] = [];

  protected override shouldUpdate(
    _changedProperties: Map<PropertyKey, unknown>
  ): boolean {
    // If this is the first update and files is empty, don't render yet
    if (!this.hasUpdated && this.files.length === 0) {
      return false;
    }
    return true;
  }

  override render(): TemplateResult<1> {
    return html`<ul>
      ${this.files.map((file) => html`<li>${file.name}</li>`)}
    </ul>`;
  }

  expand(idx: number): void {
    console.log('expand', idx);
  }
}

// Register the custom element only if it hasn't been registered yet
// This prevents errors during hot module replacement
if (
  typeof window !== 'undefined' &&
  typeof customElements !== 'undefined' &&
  customElements.get('file-tree') == null
) {
  customElements.define('file-tree', FileTree);
} else if (
  typeof customElements !== 'undefined' &&
  customElements.get('file-tree') == null
) {
  // Server-side registration for SSR (in Node.js environments with a DOM shim)
  customElements.define('file-tree', FileTree);
}
