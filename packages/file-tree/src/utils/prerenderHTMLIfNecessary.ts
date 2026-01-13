export function prerenderHTMLIfNecessary(
  element: HTMLElement,
  html: string | undefined
): void {
  if (html == null) return;
  const shadowRoot =
    element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  if (shadowRoot.innerHTML === '') {
    console.log(
      'prerendering html, but right now i wouldnt ever expect this state',
      shadowRoot
    );
    shadowRoot.innerHTML = html;
  }
}
