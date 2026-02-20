'use client';

import type {
  AnnotationSide,
  DiffLineAnnotation,
  SelectedLineRange,
} from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import { IconLink, IconParagraph } from '@pierre/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { PlaygroundAnnotationMetadata } from './constants';
import {
  CommentForm,
  ExampleThread,
  HoverButton,
} from './PlaygroundAnnotations';
import { PlaygroundControlsContent } from './PlaygroundControls';
import {
  DARK_THEMES,
  DEFAULTS,
  type HunkSeparatorValue,
  LIGHT_THEMES,
} from './playgroundOptions';
import { Button } from '@/components/ui/button';

interface PlaygroundClientProps {
  prerenderedDiff: PreloadFileDiffResult<PlaygroundAnnotationMetadata>;
}

export function PlaygroundClient({ prerenderedDiff }: PlaygroundClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const getParam = <T extends string>(key: string, defaultValue: T): T => {
    return (searchParams.get(key) as T) ?? defaultValue;
  };

  const getBoolParam = (key: string, defaultValue: boolean): boolean => {
    const value = searchParams.get(key);
    if (value === null) return defaultValue;
    return value === '1' || value === 'true';
  };

  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(
    getParam('layout', DEFAULTS.diffStyle) as 'split' | 'unified'
  );

  const [themeType, setThemeType] = useState<'system' | 'light' | 'dark'>(
    getParam('mode', DEFAULTS.themeType) as 'system' | 'light' | 'dark'
  );
  const [selectedLightTheme, setSelectedLightTheme] = useState<
    (typeof LIGHT_THEMES)[number]
  >(getParam('light', DEFAULTS.lightTheme) as (typeof LIGHT_THEMES)[number]);
  const [selectedDarkTheme, setSelectedDarkTheme] = useState<
    (typeof DARK_THEMES)[number]
  >(getParam('dark', DEFAULTS.darkTheme) as (typeof DARK_THEMES)[number]);

  const [diffIndicators, setDiffIndicators] = useState<
    'bars' | 'classic' | 'none'
  >(
    getParam('indicators', DEFAULTS.diffIndicators) as
      | 'bars'
      | 'classic'
      | 'none'
  );

  const [lineDiffType, setLineDiffType] = useState<
    'word-alt' | 'word' | 'char' | 'none'
  >(
    getParam('inline', DEFAULTS.lineDiffType) as
      | 'word-alt'
      | 'word'
      | 'char'
      | 'none'
  );

  const [hunkSeparators, setHunkSeparators] = useState<HunkSeparatorValue>(
    getParam('hunks', DEFAULTS.hunkSeparators)
  );

  const [disableBackground, setDisableBackground] = useState(
    !getBoolParam('bg', DEFAULTS.background)
  );
  const [disableLineNumbers, setDisableLineNumbers] = useState(
    !getBoolParam('ln', DEFAULTS.lineNumbers)
  );
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>(
    getBoolParam('wrap', DEFAULTS.wrap) ? 'wrap' : 'scroll'
  );

  const [enableLineSelection, setEnableLineSelection] = useState(
    getBoolParam('select', DEFAULTS.lineSelection)
  );
  const [enableHoverUtility, setEnableHoverUtility] = useState(
    getBoolParam('hover', DEFAULTS.hoverButton)
  );
  const [showAnnotations, setShowAnnotations] = useState(
    getBoolParam('annot', DEFAULTS.annotations)
  );

  const parseLineSelection = (): SelectedLineRange | null => {
    const lineParam = searchParams.get('line');
    if (lineParam == null) return null;

    const match = lineParam.match(/^(\d+)(?:-(\d+))?([ad])$/);
    if (match == null) return null;

    const start = parseInt(match[1], 10);
    const end = match[2] != null ? parseInt(match[2], 10) : start;
    const side: 'additions' | 'deletions' =
      match[3] === 'd' ? 'deletions' : 'additions';

    return { start, end, side };
  };

  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(
    parseLineSelection
  );
  const [annotations, setAnnotations] = useState<
    DiffLineAnnotation<PlaygroundAnnotationMetadata>[]
  >(prerenderedDiff.annotations ?? []);

  // Sync state from URL when searchParams change (e.g. back/forward)
  useEffect(() => {
    setDiffStyle(getParam('layout', DEFAULTS.diffStyle) as 'split' | 'unified');
    setThemeType(
      getParam('mode', DEFAULTS.themeType) as 'system' | 'light' | 'dark'
    );
    setSelectedLightTheme(
      getParam('light', DEFAULTS.lightTheme) as (typeof LIGHT_THEMES)[number]
    );
    setSelectedDarkTheme(
      getParam('dark', DEFAULTS.darkTheme) as (typeof DARK_THEMES)[number]
    );
    setDiffIndicators(
      getParam('indicators', DEFAULTS.diffIndicators) as
        | 'bars'
        | 'classic'
        | 'none'
    );
    setLineDiffType(
      getParam('inline', DEFAULTS.lineDiffType) as
        | 'word-alt'
        | 'word'
        | 'char'
        | 'none'
    );
    setHunkSeparators(getParam('hunks', DEFAULTS.hunkSeparators));
    setDisableBackground(!getBoolParam('bg', DEFAULTS.background));
    setDisableLineNumbers(!getBoolParam('ln', DEFAULTS.lineNumbers));
    setOverflow(getBoolParam('wrap', DEFAULTS.wrap) ? 'wrap' : 'scroll');
    setEnableLineSelection(getBoolParam('select', DEFAULTS.lineSelection));
    setEnableHoverUtility(getBoolParam('hover', DEFAULTS.hoverButton));
    setShowAnnotations(getBoolParam('annot', DEFAULTS.annotations));
    setSelectedRange(parseLineSelection());
  }, [searchParams]);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();

    if (diffStyle !== DEFAULTS.diffStyle) params.set('layout', diffStyle);
    if (themeType !== DEFAULTS.themeType) params.set('mode', themeType);
    if (selectedLightTheme !== DEFAULTS.lightTheme)
      params.set('light', selectedLightTheme);
    if (selectedDarkTheme !== DEFAULTS.darkTheme)
      params.set('dark', selectedDarkTheme);
    if (diffIndicators !== DEFAULTS.diffIndicators)
      params.set('indicators', diffIndicators);
    if (lineDiffType !== DEFAULTS.lineDiffType)
      params.set('inline', lineDiffType);
    if (hunkSeparators !== DEFAULTS.hunkSeparators)
      params.set('hunks', hunkSeparators);
    if (disableBackground !== !DEFAULTS.background)
      params.set('bg', disableBackground ? '0' : '1');
    if (disableLineNumbers !== !DEFAULTS.lineNumbers)
      params.set('ln', disableLineNumbers ? '0' : '1');
    if ((overflow === 'wrap') !== DEFAULTS.wrap)
      params.set('wrap', overflow === 'wrap' ? '1' : '0');
    if (enableLineSelection !== DEFAULTS.lineSelection)
      params.set('select', enableLineSelection ? '1' : '0');
    if (enableHoverUtility !== DEFAULTS.hoverButton)
      params.set('hover', enableHoverUtility ? '1' : '0');
    if (showAnnotations !== DEFAULTS.annotations)
      params.set('annot', showAnnotations ? '1' : '0');

    if (selectedRange != null) {
      const sideChar = selectedRange.side === 'deletions' ? 'd' : 'a';
      const lineValue =
        selectedRange.start === selectedRange.end
          ? `${selectedRange.start}${sideChar}`
          : `${selectedRange.start}-${selectedRange.end}${sideChar}`;
      params.set('line', lineValue);
    }

    const queryString = params.toString();
    return queryString.length > 0
      ? `/playground?${queryString}`
      : '/playground';
  }, [
    diffStyle,
    themeType,
    selectedLightTheme,
    selectedDarkTheme,
    diffIndicators,
    lineDiffType,
    hunkSeparators,
    disableBackground,
    disableLineNumbers,
    overflow,
    enableLineSelection,
    enableHoverUtility,
    showAnnotations,
    selectedRange,
  ]);

  useEffect(() => {
    const url = buildUrl();
    router.replace(url, { scroll: false });
  }, [buildUrl, router]);

  const handleCopyLink = useCallback(() => {
    const url = window.location.origin + buildUrl();
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        toast.success('Link copied to clipboard');
      })
      .catch(() => {
        toast.error('Could not copy link');
      });
  }, [buildUrl]);

  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
    },
    []
  );

  const addCommentAtLine = useCallback(
    (side: AnnotationSide, lineNumber: number) => {
      setAnnotations((prev) => {
        const hasAnnotation = prev.some(
          (ann) => ann.side === side && ann.lineNumber === lineNumber
        );
        if (hasAnnotation) return prev;

        return [
          ...prev,
          {
            side,
            lineNumber,
            metadata: {
              key: `${side}-${lineNumber}`,
              isThread: false,
            },
          },
        ];
      });
    },
    []
  );

  const handleCancelComment = useCallback(
    (side: AnnotationSide, lineNumber: number) => {
      setAnnotations((prev) =>
        prev.filter(
          (ann) => !(ann.side === side && ann.lineNumber === lineNumber)
        )
      );
      setSelectedRange(null);
    },
    []
  );

  const hasOpenCommentForm = annotations.some((ann) => !ann.metadata.isThread);

  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const closeControls = useCallback(() => setIsControlsOpen(false), []);

  useEffect(() => {
    if (isControlsOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    return () => document.body.classList.remove('overflow-hidden');
  }, [isControlsOpen]);

  useEffect(() => {
    if (!isControlsOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeControls();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isControlsOpen, closeControls]);

  const controlsContentProps = {
    diffStyle,
    setDiffStyle,
    themeType,
    setThemeType,
    selectedLightTheme,
    setSelectedLightTheme,
    selectedDarkTheme,
    setSelectedDarkTheme,
    diffIndicators,
    setDiffIndicators,
    lineDiffType,
    setLineDiffType,
    hunkSeparators,
    setHunkSeparators,
    disableBackground,
    setDisableBackground,
    disableLineNumbers,
    setDisableLineNumbers,
    overflow,
    setOverflow,
    enableLineSelection,
    setEnableLineSelection,
    enableHoverUtility,
    setEnableHoverUtility,
    showAnnotations,
    setShowAnnotations,
    selectedRange,
    setSelectedRange,
    handleCopyLink,
    addCommentAtLine,
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2 md:hidden">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setIsControlsOpen(true)}
            aria-label="Open options"
          >
            <IconParagraph />
            Options
          </Button>
          <Button
            variant="outline"
            onClick={handleCopyLink}
            className="ms-auto"
          >
            <IconLink />
            Copy link
          </Button>
        </div>

        <div className="hidden md:block">
          <PlaygroundControlsContent {...controlsContentProps} />
        </div>

        <div className="md:hidden">
          {isControlsOpen && (
            <div
              className="bg-background/50 fixed inset-0 z-[50] backdrop-blur-sm transition-opacity duration-200"
              onClick={closeControls}
              aria-hidden
            />
          )}
          <div
            className={`playground-controls-drawer ${isControlsOpen ? 'is-open' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-medium">Options</span>
              <Button variant="ghost" size="sm" onClick={closeControls}>
                Close
              </Button>
            </div>
            <PlaygroundControlsContent {...controlsContentProps} hideShare />
          </div>
        </div>
      </div>

      <FileDiff
        {...prerenderedDiff}
        className="border-border overflow-hidden rounded-lg border"
        selectedLines={selectedRange}
        lineAnnotations={showAnnotations ? annotations : []}
        options={{
          ...prerenderedDiff.options,
          diffStyle,
          diffIndicators,
          lineDiffType,
          hunkSeparators,
          disableBackground,
          disableLineNumbers,
          overflow,
          themeType,
          theme: { dark: selectedDarkTheme, light: selectedLightTheme },
          enableLineSelection: enableLineSelection && !hasOpenCommentForm,
          enableHoverUtility: enableHoverUtility && !hasOpenCommentForm,
          onLineSelected: handleLineSelectionEnd,
        }}
        renderHoverUtility={
          enableHoverUtility
            ? (getHoveredLine) => (
                <HoverButton
                  getHoveredLine={getHoveredLine}
                  onAddComment={addCommentAtLine}
                />
              )
            : undefined
        }
        renderAnnotation={
          showAnnotations
            ? (annotation) =>
                annotation.metadata.isThread ? (
                  <ExampleThread />
                ) : (
                  <CommentForm
                    side={annotation.side}
                    lineNumber={annotation.lineNumber}
                    onCancel={handleCancelComment}
                  />
                )
            : undefined
        }
      />
    </div>
  );
}
