export function prerenderHTMLIfNecessary(
  element: HTMLElement,
  html: string | undefined
): void {
  if (html == null) return;
  const shadowRoot =
    element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  if (shadowRoot.innerHTML === '') {
    shadowRoot.innerHTML = html;
  }
}
