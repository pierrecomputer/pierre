'use client';

import { HEADER_SLOT_NAME } from '@pierre/trees';

export function DemoHeaderContent({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 12px',
        borderBottom:
          '1px solid color-mix(in srgb, var(--color-border) 80%, transparent)',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-bg) 96%, white), color-mix(in srgb, var(--color-bg) 88%, white))',
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-fg-muted, #666)' }}>
          Click to log and verify the slotted subtree hydrated
        </div>
      </div>
      <button
        type="button"
        className="rounded-sm border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--color-border)' }}
        onClick={onClick}
      >
        Log Header Click
      </button>
    </div>
  );
}

export function vanillaHeaderSlotMarkup(label: string): string {
  return `
    <div
      slot="${HEADER_SLOT_NAME}"
      style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-bottom:1px solid color-mix(in srgb, var(--color-border) 80%, transparent);background:linear-gradient(180deg, color-mix(in srgb, var(--color-bg) 96%, white), color-mix(in srgb, var(--color-bg) 88%, white));"
    >
      <div>
        <div style="font-size:12px;font-weight:700;letter-spacing:0.04em;">${label}</div>
        <div style="font-size:12px;color:var(--color-fg-muted, #666);">Click to log and verify the slotted subtree hydrated</div>
      </div>
      <button
        type="button"
        data-demo-header-button="true"
        class="rounded-sm border px-2 py-1 text-xs"
        style="border-color:var(--color-border);"
      >
        Log Header Click
      </button>
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
