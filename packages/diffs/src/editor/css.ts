export const editorCSS: string = /* CSS */ `
  ::selection {
    background-color: transparent;
  }
  @keyframes blinking {
    0% { opacity: 1; }
    50% { opacity: 0; }
    100% { opacity: 1; }
  }
  :host, /* for jump anchor */
  [data-code], /* for editor overlay */
  [data-content] /* for wrap line */
  {
    position: relative;
  }
  [data-content] {
    background-color: transparent;
    caret-color: var(--diffs-bg-caret);
    outline: none;
  }
  @media (min-width: 480px) {
    [data-content] {
      caret-color: transparent;
    }
    [data-quick-edit] {
      caret-color: currentColor;
    }
  }
  [data-line] {
    cursor: text;
  }
  [data-line]:not([data-selected-line]),
  [data-line]:not([data-selected-line]) span {
    background-color: transparent;
  }
  [data-line]:is([data-selected-line]),
  [data-line]:is([data-selected-line]) span,
  [data-line-annotation]:is([data-selected-line]) {
    background-color: var(--diffs-editor-line-highlight-bg);
  }
  [data-column-number] {
    color: var(--diffs-editor-line-number-fg);
  }
  [data-column-number]:is([data-selected-line]),
  [data-gutter-buffer]:is([data-selected-line]) {
    background-color: var(--diffs-editor-line-number-active-bg);
    color: var(--diffs-editor-line-number-active-fg);
  }
  [data-column-number]:is([data-active]) {
    color: var(--diffs-editor-line-number-active-fg);
  }
  [data-line]:is([data-line-type='change-deletion']) {
    background-color: var(--diffs-line-bg);
    -webkit-user-select: none;
    user-select: none;
  }
  [data-caret], [data-selection-range] {
    position: absolute;
    top: 0;
    left: 0;
    line-height: var(--diffs-line-height);
    pointer-events: none;
  }
  [data-caret] {
    width: 2px;
    height: 1lh;
    background-color: var(--diffs-bg-caret-override, var(--diffs-editor-cursor-fg,
      light-dark(
        color-mix(in lab, var(--diffs-fg) 50%, var(--diffs-bg)),
        color-mix(in lab, var(--diffs-fg) 75%, var(--diffs-bg))
      ))
    );
    animation: blinking 1.2s infinite;
    animation-delay: 0.8s;
    visibility: hidden;
  }
  [data-selection-range] {
    height: 1lh;
    z-index: -10;
    background-color: var(--diffs-editor-selection-bg);
  }
  [data-selection-corner] {
    width: 100%;
    height: 100%;
    background-color: var(--diffs-bg);
  }
  [data-rtl] {
    border-top-left-radius: 3px;
  }
  [data-rtr] {
    border-top-right-radius: 3px;
  }
  [data-rbl] {
    border-bottom-left-radius: 3px;
  }
  [data-rbr] {
    border-bottom-right-radius: 3px;
  }
  [data-editor-overlay] {
    display: contents;
  }
  @media (min-width: 480px) {
    [data-content]:focus ~ [data-editor-overlay] [data-caret] {
      visibility: visible;
    }
  }

  [data-quick-edit-icon] {
    position: absolute;
    top: 0;
    left: calc(-1lh + 2px);
    z-index: 10;
    width: 1lh;
    height: 1lh;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: color-mix(in lab, var(--diffs-fg) 40%, var(--diffs-bg));
    transition: background-color 0.1s ease-in-out, color 0.1s ease-in-out;
    cursor: pointer;
    visibility: hidden;
  }
  [data-quick-edit-icon][data-visible='true'] {
    visibility: visible;
  }
  [data-quick-edit-icon]:hover {
    background-color: color-mix(in lab, var(--diffs-fg) 8%, var(--diffs-bg));
    color: var(--diffs-fg);
  }
  [data-quick-edit] {
    padding-inline-end: 1ch;
  }

  [data-search-panel] {
    position: sticky;
    top: 8px;
    left: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-inline: 1ch;
    margin-bottom: 4px;
    background-color: color-mix(in lab, color-mix(in lab, var(--diffs-fg) 4%, var(--diffs-bg)), transparent 40%);
    border: 1px solid color-mix(in lab, var(--diffs-fg) 8%, var(--diffs-bg));
    padding: 6px;
    border-radius: 6px;
    box-shadow: 0 0 12px 0 color-mix(in lab, var(--diffs-fg) 16% var(--diffs-bg));
    backdrop-filter: blur(8px);
  }
  [data-search-panel-row] {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 2px;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 14px;
  }
  [data-search-panel-row] input {
    font-size: 14px;
    line-height: 24px;
    max-width: 50%;
    padding-inline: 4px;
    border: none;
    outline: none;
    background-color: transparent;
    color: var(--diffs-fg);
    field-sizing: content;
  }
  [data-search-panel-row] input::selection {
    background-color: color-mix(in lab, var(--diffs-fg) 8%, var(--diffs-bg));
  }
  [data-search-panel-row] [data-matches] {
    font-size: 12px;
    font-weight: 500;
    line-height: 20px;
    padding-inline-start: 4px;
    padding-inline-end: 8px;
    color: color-mix(in lab, var(--diffs-fg) 50%, var(--diffs-bg));
  }
  [data-search-panel-row] [data-matches][data-no-matches] {
    color: color-mix(in lab, var(--diffs-deletion-base) 90%, var(--diffs-bg));
  }
  [data-search-panel-row] [data-icon] {
    width: 24px;
    height: 24px;
    display: flex;
    color: color-mix(in lab, var(--diffs-fg) 40%, var(--diffs-bg));
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.1s ease-in-out, color 0.1s ease-in-out;
  }
  [data-search-panel-row] [data-icon][data-disabled='true'] {
    visibility: hidden;
  }
  [data-search-panel-row] [data-icon]:not([data-icon='search']):hover {
    background-color: color-mix(in lab, var(--diffs-fg) 6%, var(--diffs-bg));
    color: var(--diffs-fg);
  }
  [data-search-panel-row] [data-settings] {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    padding: 0 8px;
  }
  [data-search-panel-row] [data-checkbox] {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 12px;
    color: color-mix(in lab, var(--diffs-fg) 60%, var(--diffs-bg));
  }
  [data-search-panel-row] [data-checkbox] input {
    margin: 0;
  }
  [data-search-panel-row] [data-checkbox]:hover,
  [data-search-panel-row] [data-checkbox]:has(input:checked) {
    color: var(--diffs-fg);
  }
  [data-search-panel-row] [data-spacer] {
    flex: 1;
  }
`;

// Safari doesn't support `::selection` for slot elements in ShadowDOM,
// Add a global style to disable selection for slot elements
export const editorGlobalCSS = /* CSS */ `
  [data-annotation-slot] {
    user-select: none;
    -webkit-user-select: none;
  }
`;
