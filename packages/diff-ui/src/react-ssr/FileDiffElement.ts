import '@lit-labs/ssr-client/lit-element-hydrate-support.js';
import '@lit-labs/ssr-react/enable-lit-ssr.js';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import rawStyles from '../style.css?raw';

@customElement('file-diff')
export class FileDiffElement extends LitElement {
  static override styles = css`
    @layer base, theme, util;
    @layer base {
      ${unsafeCSS(rawStyles)}
    }
  `;

  declare code: string;
  declare css: string;
  static override properties = {
    code: { type: String },
    css: { type: String },
  };

  constructor() {
    super();
    this.code = 'no code provided';
    this.css = '';
  }

  override render() {
    const style = html`<style>
      @layer base, theme, util;
      @layer theme {
        ${unsafeCSS(this.css)}
      }
    </style>`;
    return html`
      ${style}
      <div class="file-diff-container">${unsafeHTML(this.code)}</div>
      <slot></slot>
    `;
  }
}
