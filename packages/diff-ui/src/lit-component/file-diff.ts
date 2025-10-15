import { LitElement, css, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

export class FileDiff extends LitElement {
  static override styles = css`
    code {
      font-family: var(--font-mono);
    }
  `;

  static override properties = {
    code: { attribute: false },
  };

  /**
   * HTML code to render
   */
  code?: string;

  override render() {
    // If we have code, render it directly
    if (this.code != null && this.code.length > 0) {
      return html`
        <div class="file-diff-container">${unsafeHTML(this.code)}</div>
        <slot></slot>
      `;
    }

    // Otherwise, render an empty container
    return html`
      <div class="file-diff-container">No content provided</div>
      <slot></slot>
    `;
  }
}

// Register the custom element
customElements.define('file-diff', FileDiff);
