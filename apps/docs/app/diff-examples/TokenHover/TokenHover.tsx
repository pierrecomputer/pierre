'use client';

import type { DiffTokenEventBaseProps } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { type CSSHoverInfo, lookupCSSToken } from './css-index';

/**
 * Reconstruct compound CSS tokens from adjacent sibling elements.
 * Pierre's Shiki theme splits selectors into individual tokens
 * (e.g. `.` + `card-grid`, `&` + `:` + `hover`, `@` + `container`),
 * so we look at neighboring siblings to build the full identifier.
 */
function resolveCompoundToken(
  tokenText: string,
  tokenElement: HTMLElement
): string {
  const prev = tokenElement.previousElementSibling;
  const prevText = prev?.textContent ?? '';
  const next = tokenElement.nextElementSibling;
  const nextText = next?.textContent ?? '';

  // `@` + keyword  →  `@container`, `@layer`, `@media`, etc.
  if (prevText === '@') return `@${tokenText}`;

  // `.` or `#` prefix  →  `.card-grid`, `#main`, etc.
  if (prevText === '.' || prevText === '#') return `${prevText}${tokenText}`;

  // `:` between `&` and a pseudo-class name  →  `&:hover`
  // Tokens arrive as `&`, `:`, `hover` — when hovering `:`, combine with neighbors
  if (tokenText === ':' && nextText.length > 0 && !/\s/.test(nextText[0])) {
    const pseudo = `:${nextText}`;
    if (prevText === '&') return `&${pseudo}`;
    return pseudo;
  }

  // bare pseudo-class name after `:`  →  `:hover`, `:focus-visible`
  if (prevText === ':') {
    const grandPrev = prev?.previousElementSibling?.textContent ?? '';
    const pseudo = `:${tokenText}`;
    if (grandPrev === '&') return `&${pseudo}`;
    return pseudo;
  }

  // standalone `.` or `#` followed by a name  →  `.card-grid`
  if ((tokenText === '.' || tokenText === '#') && nextText.length > 0) {
    return `${tokenText}${nextText}`;
  }

  return tokenText;
}

interface TokenHoverProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

interface HoverState {
  info: CSSHoverInfo;
  x: number;
  y: number;
  tokenElement: HTMLElement;
}

const DISMISS_DELAY_MS = 200;

export function TokenHover({ prerenderedDiff }: TokenHoverProps) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const activeTokenRef = useRef<HTMLElement | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipHoveredRef = useRef(false);

  const cancelDismiss = useCallback(() => {
    if (dismissTimerRef.current != null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const clearHover = useCallback(() => {
    cancelDismiss();
    tooltipHoveredRef.current = false;
    if (activeTokenRef.current != null) {
      activeTokenRef.current.style.textDecoration = '';
      activeTokenRef.current.style.backgroundColor = '';
      activeTokenRef.current.style.borderRadius = '';
      activeTokenRef.current = null;
    }
    setHover(null);
  }, [cancelDismiss]);

  /** Start a delayed dismiss — cancelled if the cursor enters the tooltip or a new token. */
  const scheduleDismiss = useCallback(() => {
    cancelDismiss();
    dismissTimerRef.current = setTimeout(() => {
      if (!tooltipHoveredRef.current) {
        clearHover();
      }
    }, DISMISS_DELAY_MS);
  }, [cancelDismiss, clearHover]);

  const onTooltipEnter = useCallback(() => {
    tooltipHoveredRef.current = true;
    cancelDismiss();
  }, [cancelDismiss]);

  const onTooltipLeave = useCallback(() => {
    tooltipHoveredRef.current = false;
    scheduleDismiss();
  }, [scheduleDismiss]);

  useEffect(() => cancelDismiss, [cancelDismiss]);

  useEffect(() => {
    const container = containerRef.current;
    if (container == null) return;

    const scrollParents: Element[] = [];
    let el: Element | null = container;
    while (el != null) {
      if (
        el.scrollHeight > el.clientHeight ||
        el.scrollWidth > el.clientWidth
      ) {
        scrollParents.push(el);
      }
      el = el.parentElement;
    }

    const onScroll = () => clearHover();
    for (const sp of scrollParents) {
      sp.addEventListener('scroll', onScroll, { passive: true });
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      for (const sp of scrollParents) {
        sp.removeEventListener('scroll', onScroll);
      }
      window.removeEventListener('scroll', onScroll);
    };
  }, [clearHover]);

  const onTokenEnter = useCallback(
    ({ tokenText, tokenElement }: DiffTokenEventBaseProps) => {
      cancelDismiss();

      const resolvedText = resolveCompoundToken(tokenText, tokenElement);
      const info = lookupCSSToken(resolvedText);
      if (info == null) {
        clearHover();
        return;
      }

      if (
        activeTokenRef.current != null &&
        activeTokenRef.current !== tokenElement
      ) {
        activeTokenRef.current.style.textDecoration = '';
        activeTokenRef.current.style.backgroundColor = '';
        activeTokenRef.current.style.borderRadius = '';
      }

      const rect = tokenElement.getBoundingClientRect();
      tokenElement.style.textDecoration = 'underline';
      tokenElement.style.backgroundColor =
        'color-mix(in srgb, currentColor 12%, transparent)';
      tokenElement.style.borderRadius = '2px';
      activeTokenRef.current = tokenElement;

      setHover({
        info,
        x: rect.left + rect.width / 2,
        y: rect.top,
        tokenElement,
      });
    },
    [cancelDismiss, clearHover]
  );

  const onTokenLeave = useCallback(() => {
    scheduleDismiss();
  }, [scheduleDismiss]);

  return (
    <div className="space-y-5">
      <FeatureHeader
        id="token-hover"
        title="Token Hover"
        description={
          <>
            Attach hover callbacks to individual syntax tokens with{' '}
            <code>onTokenEnter</code> and <code>onTokenLeave</code>. This
            example pairs them with a static CSS knowledge index to show
            Intellisense-style tooltips — no LSP required. Try hovering over CSS
            properties, values, and at-rules below.
          </>
        }
      />

      <div ref={containerRef} className="relative">
        <MultiFileDiff
          {...prerenderedDiff}
          className="overflow-hidden rounded-lg border dark:border-neutral-800"
          options={{
            ...prerenderedDiff.options,
            onTokenEnter,
            onTokenLeave,
          }}
        />

        {hover != null && (
          <HoverTooltip
            ref={tooltipRef}
            info={hover.info}
            x={hover.x}
            y={hover.y}
            onMouseEnter={onTooltipEnter}
            onMouseLeave={onTooltipLeave}
          />
        )}
      </div>
    </div>
  );
}

const CATEGORY_LABELS: Record<CSSHoverInfo['category'], string> = {
  property: 'property',
  'custom-property': 'custom property',
  value: 'value',
  'at-rule': 'at-rule',
  selector: 'selector',
  function: 'function',
};

interface HoverTooltipProps {
  info: CSSHoverInfo;
  x: number;
  y: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const HoverTooltip = forwardRef<HTMLDivElement, HoverTooltipProps>(
  function HoverTooltip({ info, x, y, onMouseEnter, onMouseLeave }, ref) {
    const [position, setPosition] = useState<{
      left: number;
      top: number;
      flipped: boolean;
    } | null>(null);

    const innerRef = useRef<HTMLDivElement>(null);

    const setRefs = useCallback(
      (el: HTMLDivElement | null) => {
        (innerRef as { current: HTMLDivElement | null }).current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref != null)
          (ref as { current: HTMLDivElement | null }).current = el;
      },
      [ref]
    );

    useEffect(() => {
      const tooltip = innerRef.current;
      if (tooltip == null) return;

      const tooltipRect = tooltip.getBoundingClientRect();
      const tooltipHeight = tooltipRect.height;
      const tooltipWidth = tooltipRect.width;

      const GAP = 6;
      const VIEWPORT_PAD = 8;

      const flipped = y - tooltipHeight - GAP < VIEWPORT_PAD;
      const top = flipped ? y + 24 + GAP : y - tooltipHeight - GAP;

      let left = x - tooltipWidth / 2;
      left = Math.max(
        VIEWPORT_PAD,
        Math.min(left, window.innerWidth - tooltipWidth - VIEWPORT_PAD)
      );

      setPosition({ left, top, flipped });
    }, [x, y]);

    return (
      <div
        ref={setRefs}
        className="token-hover-tooltip"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        style={{
          position: 'fixed',
          left: position?.left ?? x,
          top: position?.top ?? y - 40,
          zIndex: 9999,
          pointerEvents: 'auto',
          opacity: position != null ? 1 : 0,
          transition: 'opacity 0.1s ease-out',
        }}
      >
        <div className="flex max-w-[400px] flex-col gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-sm shadow-xl shadow-black/30">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-blue-300">
              {info.name}
            </span>
            <span className="rounded bg-neutral-700/70 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-neutral-400">
              {CATEGORY_LABELS[info.category]}
            </span>
          </div>
          <p className="leading-snug text-neutral-300">{info.description}</p>
          {info.syntax != null && (
            <code className="block rounded bg-neutral-800 px-2 py-1 font-mono text-xs leading-relaxed text-emerald-300/90">
              {info.syntax}
            </code>
          )}
          {info.specificity != null && (
            <span className="text-xs text-neutral-400">
              Specificity:{' '}
              <span className="font-mono text-purple-300/90">
                {info.specificity}
              </span>
            </span>
          )}
          {info.origin != null && (
            <span className="text-xs text-neutral-500">
              Defined in{' '}
              <span className="font-mono text-yellow-400/80">
                {info.origin}
              </span>
            </span>
          )}
          {info.mdnURL != null && (
            <a
              href={info.mdnURL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-neutral-400 no-underline hover:text-neutral-300 hover:underline"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" role="img">
                <path
                  fill="currentcolor"
                  d="M9.4 0 2.81 21.17H.12L6.69 0H9.4Zm2.38 0v21.17H9.4V0h2.4Zm9.27 0-6.56 21.17H11.8L18.36 0h2.69Zm2.39 0v21.17h-2.4V0h2.4Z"
                ></path>
              </svg>
              Learn more on MDN
            </a>
          )}
        </div>
      </div>
    );
  }
);
