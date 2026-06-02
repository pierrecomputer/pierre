export type SVGSpriteNames =
  | 'arrow-down'
  | 'arrow-up'
  | 'close'
  | 'quick'
  | 'search'
  | 'settings';

export const SVGSpriteSheet = `<svg data-editor-icon-sprite aria-hidden="true" width="0" height="0">
  <symbol id="diffs-editor-icon-arrow-down" viewBox="0 0 20 20">
    <polyline points="7.5 16.5 14 10 7.5 3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></polyline>
  </symbol>
  <symbol id="diffs-editor-icon-arrow-up" viewBox="0 0 20 20">
    <polyline points="12.5 3.5 6 10 12.5 16.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></polyline>
  </symbol>
  <symbol id="diffs-editor-icon-close" viewBox="0 0 20 20">
    <line x1="5" y1="5" x2="15" y2="15" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
    <line x1="5" y1="15" x2="15" y2="5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
  </symbol>
  <symbol id="diffs-editor-icon-quick" viewBox="0 0 20 20">
    <polygon points="11 3 9 9 16 9 9 17 11 11 4 11 11 3" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></polygon>
  </symbol>
  <symbol id="diffs-editor-icon-search" viewBox="0 0 20 20">
    <line x1="16.5" y1="16.5" x2="12.0355" y2="12.0355" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
    <circle cx="8.5" cy="8.5" r="5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></circle>
  </symbol>
  <symbol id="diffs-editor-icon-settings" viewBox="0 0 20 20">
    <line x1="3" y1="6" x2="10" y2="6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
    <circle cx="12.5" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></circle>
    <line x1="15" y1="6" x2="17" y2="6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
    <line x1="17" y1="14" x2="10" y2="14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
    <circle cx="7.5" cy="14" r="2.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></circle>
    <line x1="5" y1="14" x2="3" y2="14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
  </symbol>
</svg>`;

export const getEditorIconSvg = (name: SVGSpriteNames, size = 16): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
<use href="#diffs-editor-icon-${name}"></use>
</svg>`;
