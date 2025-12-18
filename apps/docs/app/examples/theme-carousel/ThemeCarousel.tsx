'use client';

import { IconChevron } from '@/components/icons';
import { FileDiff } from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import { useEffect, useRef, useState } from 'react';

import { THEMES } from './constants';

// =============================================================================
// Main Component
// =============================================================================

interface ThemeCarouselProps {
  prerenderedDiff: PreloadFileDiffResult<undefined>;
}

export function ThemeCarousel({ prerenderedDiff }: ThemeCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [themeBg, setThemeBg] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentTheme = THEMES[currentIndex];

  const prev = () =>
    setCurrentIndex((i) => (i === 0 ? THEMES.length - 1 : i - 1));
  const next = () =>
    setCurrentIndex((i) => (i === THEMES.length - 1 ? 0 : i + 1));

  // Use MutationObserver to detect when the pierre-diffs style changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateBg = () => {
      const diffsElement = container.querySelector('pierre-diffs');
      if (diffsElement instanceof HTMLElement) {
        // Read directly from inline style attribute
        const style = diffsElement.getAttribute('style') || '';
        const match = style.match(/--diffs-bg:\s*([^;]+)/);
        if (match) {
          setThemeBg(match[1].trim());
        }
      }
    };

    // Initial check
    updateBg();

    // Watch for style attribute changes on pierre-diffs
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'style'
        ) {
          updateBg();
        }
      }
    });

    const diffsElement = container.querySelector('pierre-diffs');
    if (diffsElement) {
      observer.observe(diffsElement, { attributes: true });
    }

    return () => observer.disconnect();
  }, [currentIndex]);

  // Colors based on current theme
  const isDark = currentTheme.type === 'dark';
  const borderColor = isDark ? 'border-neutral-800' : 'border-neutral-300';
  const textColor = isDark ? 'text-neutral-200' : 'text-neutral-800';
  const mutedText = isDark ? 'text-neutral-500' : 'text-neutral-500';
  const pillBg = isDark ? 'bg-white/10' : 'bg-black/10';

  // Use theme bg from CSS variable, fallback to constant
  const backgroundColor = themeBg || currentTheme.bg;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-medium">Theme carousel</h2>
        <p className="text-muted-foreground">
          Browse through {THEMES.length} beautiful syntax themes. Use any Shiki
          theme or our custom Pierre themes designed for optimal diff
          readability.
        </p>
      </div>

      <div
        ref={containerRef}
        className={`overflow-hidden rounded-xl border ${borderColor} transition-colors duration-300`}
        style={{ backgroundColor }}
      >
        <div
          className={`flex items-center justify-between ${borderColor} px-4 py-3`}
        >
          <div className="flex items-center gap-1">
            <button
              onClick={prev}
              className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg ${pillBg} ${textColor} transition-opacity hover:opacity-80`}
              aria-label="Previous"
            >
              <IconChevron size={12} style={{ transform: 'rotate(90deg)' }} />
            </button>
            <button
              onClick={next}
              className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg ${pillBg} ${textColor} transition-opacity hover:opacity-80`}
              aria-label="Next"
            >
              <IconChevron size={12} style={{ transform: 'rotate(-90deg)' }} />
            </button>
          </div>

          <div className={`text-center ${textColor}`}>
            <span className="font-medium">{currentTheme.label}</span>
            <span className={`ml-2 text-sm ${mutedText}`}>
              {currentIndex + 1} / {THEMES.length}
            </span>
          </div>

          <div
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${pillBg} ${
              isDark ? 'text-neutral-300' : 'text-neutral-700'
            }`}
          >
            {currentTheme.type}
          </div>
        </div>

        <div
          className={`flex justify-center gap-1.5 border-b ${borderColor} pb-4`}
        >
          {THEMES.map((theme, i) => (
            <button
              key={theme.name}
              onClick={() => setCurrentIndex(i)}
              className={`h-2 w-2 cursor-pointer rounded-full transition-all ${
                i === currentIndex
                  ? 'scale-125 bg-blue-500'
                  : isDark
                    ? 'bg-neutral-700 hover:bg-neutral-600'
                    : 'bg-neutral-300 hover:bg-neutral-400'
              }`}
              aria-label={`Switch to ${theme.label}`}
            />
          ))}
        </div>

        {/* Diff content */}
        <FileDiff
          {...prerenderedDiff}
          options={{
            ...prerenderedDiff.options,
            theme: currentTheme.name,
            themeType: currentTheme.type,
            disableFileHeader: true,
          }}
        />
      </div>
    </div>
  );
}
