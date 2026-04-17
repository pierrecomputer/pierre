'use client';

import { HEADER_SLOT_NAME } from '@pierre/trees';

const UNITLESS_PROPERTIES = new Set([
  'animationIterationCount',
  'columns',
  'columnCount',
  'flex',
  'flexGrow',
  'flexShrink',
  'fontWeight',
  'gridColumn',
  'gridRow',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'tabSize',
  'widows',
  'zIndex',
]);

/** Converts a React CSSProperties object to a CSS style attribute string. */
function cssToStr(style: React.CSSProperties): string {
  return Object.entries(style)
    .map(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const cssValue =
        typeof value === 'number' && !UNITLESS_PROPERTIES.has(key)
          ? `${value}px`
          : value;
      return `${cssKey}:${cssValue}`;
    })
    .join(';');
}

const iconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: 'block',
  fill: 'none',
};
const iconStyleStr = cssToStr(iconStyle);

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 0,
};
const buttonStyleStr = cssToStr(buttonStyle);
const buttonCss = `[data-header-add-file],[data-header-add-folder]{color:var(--color-fg-muted,#666)}[data-header-add-file]:hover,[data-header-add-folder]:hover{color:var(--color-fg,#999)}`;

const filePlusIcon = `<svg style="${iconStyleStr}" viewBox="0 0 16 16"><path fill="currentColor" d="M8 1v3a3 3 0 0 0 3 3h3v5.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 12.5v-9A2.5 2.5 0 0 1 4.5 1z" opacity=".4"/><path fill="currentColor" d="M8 7a.5.5 0 0 1 .5.5v2h2a.5.5 0 0 1 0 1h-2v2a.5.5 0 0 1-1 0v-2h-2a.5.5 0 0 1 0-1h2v-2A.5.5 0 0 1 8 7M9.5 1a.5.5 0 0 1 .354.146l4 4A.5.5 0 0 1 14 5.5V6h-3a2 2 0 0 1-2-2V1z"/></svg>`;

const folderPlusIcon = `<svg style="${iconStyleStr}" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M14 12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6h14zM7 7a.5.5 0 0 0-.5.5v2h-2a.5.5 0 0 0 0 1h2v2a.5.5 0 0 0 1 0v-2h2a.5.5 0 0 0 0-1h-2v-2A.5.5 0 0 0 7 7" clip-rule="evenodd"/><path fill="currentColor" d="M4.585 2a2 2 0 0 1 1.028.285l1.788 1.072a1 1 0 0 0 .514.143H12c.932 0 1.712.638 1.935 1.5H0V4a2 2 0 0 1 2-2z" opacity=".5"/></svg>`;

const folderIcon = `<svg style="${iconStyleStr}" viewBox="0 0 16 16"><path fill="currentColor" d="M14 15H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2.2a2 2 0 0 1 1.38.552l.34.325a2 2 0 0 0 1.38.552H14a2 2 0 0 1 2 2V13a2 2 0 0 1-2 2"/><path fill="currentColor" d="M4.4 1a1.5 1.5 0 0 1 1.035.414l.63.6A1.5 1.5 0 0 0 7.1 2.43H11a2 2 0 0 1 2 2v1h-2.9a.5.5 0 0 1-.345-.138l-.631-.602A2.5 2.5 0 0 0 7.4 4H4.5A2.5 2.5 0 0 0 2 6.5V11a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" opacity=".4"/></svg>`;

function FilePlusIcon() {
  return (
    <svg style={iconStyle} viewBox="0 0 16 16">
      <path
        fill="currentColor"
        opacity={0.4}
        d="M8 1v3a3 3 0 0 0 3 3h3v5.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 12.5v-9A2.5 2.5 0 0 1 4.5 1z"
      />
      <path
        fill="currentColor"
        d="M8 7a.5.5 0 0 1 .5.5v2h2a.5.5 0 0 1 0 1h-2v2a.5.5 0 0 1-1 0v-2h-2a.5.5 0 0 1 0-1h2v-2A.5.5 0 0 1 8 7M9.5 1a.5.5 0 0 1 .354.146l4 4A.5.5 0 0 1 14 5.5V6h-3a2 2 0 0 1-2-2V1z"
      />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg style={iconStyle} viewBox="0 0 16 16">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14 12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6h14zM7 7a.5.5 0 0 0-.5.5v2h-2a.5.5 0 0 0 0 1h2v2a.5.5 0 0 0 1 0v-2h2a.5.5 0 0 0 0-1h-2v-2A.5.5 0 0 0 7 7"
      />
      <path
        fill="currentColor"
        opacity={0.5}
        d="M4.585 2a2 2 0 0 1 1.028.285l1.788 1.072a1 1 0 0 0 .514.143H12c.932 0 1.712.638 1.935 1.5H0V4a2 2 0 0 1 2-2z"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg style={{ ...iconStyle, flexShrink: 0 }} viewBox="0 0 16 16">
      <path
        fill="currentColor"
        d="M14 15H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2.2a2 2 0 0 1 1.38.552l.34.325a2 2 0 0 0 1.38.552H14a2 2 0 0 1 2 2V13a2 2 0 0 1-2 2"
      />
      <path
        fill="currentColor"
        opacity={0.4}
        d="M4.4 1a1.5 1.5 0 0 1 1.035.414l.63.6A1.5 1.5 0 0 0 7.1 2.43H11a2 2 0 0 1 2 2v1h-2.9a.5.5 0 0 1-.345-.138l-.631-.602A2.5 2.5 0 0 0 7.4 4H4.5A2.5 2.5 0 0 0 2 6.5V11a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z"
      />
    </svg>
  );
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '6px 8px 6px 10px',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--color-bg) 96%, white), color-mix(in srgb, var(--color-bg) 88%, white))',
};
const headerStyleStr = cssToStr(headerStyle);

const projectLabelGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
};
const projectLabelGroupStyleStr = cssToStr(projectLabelGroupStyle);

const projectNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.01em',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const projectNameStyleStr = cssToStr(projectNameStyle);

const buttonGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
};
const buttonGroupStyleStr = cssToStr(buttonGroupStyle);

export function ProjectHeader({
  projectName,
  onAddFile,
  onAddFolder,
}: {
  projectName: string;
  onAddFile: () => void;
  onAddFolder: () => void;
}) {
  return (
    <div style={headerStyle}>
      <style dangerouslySetInnerHTML={{ __html: buttonCss }} />
      <div style={projectLabelGroupStyle}>
        <FolderIcon />
        <span style={projectNameStyle}>{projectName}</span>
      </div>
      <div style={buttonGroupStyle}>
        <button
          type="button"
          title="New File"
          data-header-add-file="true"
          style={buttonStyle}
          onClick={onAddFile}
        >
          <FilePlusIcon />
        </button>
        <button
          type="button"
          title="New Folder"
          data-header-add-folder="true"
          style={buttonStyle}
          onClick={onAddFolder}
        >
          <FolderPlusIcon />
        </button>
      </div>
    </div>
  );
}

export function vanillaProjectHeaderMarkup(projectName: string): string {
  return `
    <style>${buttonCss}</style>
    <div
      slot="${HEADER_SLOT_NAME}"
      style="${headerStyleStr}"
    >
      <div style="${projectLabelGroupStyleStr}">
        ${folderIcon}
        <span style="${projectNameStyleStr}">${projectName}</span>
      </div>
      <div style="${buttonGroupStyleStr}">
        <button
          type="button"
          title="New File"
          data-header-add-file="true"
          style="${buttonStyleStr}"
        >
          ${filePlusIcon}
        </button>
        <button
          type="button"
          title="New Folder"
          data-header-add-folder="true"
          style="${buttonStyleStr}"
        >
          ${folderPlusIcon}
        </button>
      </div>
    </div>
  `;
}

export function injectSlotMarkup(
  containerHtml: string,
  slotMarkup: string
): string {
  return containerHtml.replace(
    '</file-tree-container>',
    `${slotMarkup}</file-tree-container>`
  );
}
