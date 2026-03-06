'use client';

import type {
  AnnotationSide,
  DiffLineAnnotation,
  SelectedLineRange,
} from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import {
  IconCheck,
  IconChevronSm,
  IconCodeStyleBars,
  IconCodeStyleBg,
  IconCodeStyleInline,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
  IconCursor,
  IconDiffSplit,
  IconDiffUnified,
  IconHunkDivider,
  IconInReview,
  IconLink,
  IconListOrdered,
  IconParagraph,
  IconSymbolDiffstat,
  IconWordWrap,
  IconXSquircle,
} from '@pierre/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { PlaygroundAnnotationMetadata } from './constants';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

const LIGHT_THEMES = [
  'pierre-light',
  'catppuccin-latte',
  'github-light',
  'one-light',
  'solarized-light',
] as const;

const DARK_THEMES = [
  'pierre-dark',
  'catppuccin-mocha',
  'dracula',
  'github-dark',
  'one-dark-pro',
  'tokyo-night',
  'vitesse-dark',
] as const;

const LINE_DIFF_OPTIONS = [
  { value: 'word-alt', label: 'Word-Alt' },
  { value: 'word', label: 'Word' },
  { value: 'char', label: 'Character' },
  { value: 'none', label: 'None' },
] as const;

const HUNK_SEPARATOR_OPTIONS = [
  { value: 'line-info', label: 'Line-Info' },
  { value: 'line-info-basic', label: 'Line-Info-Basic' },
  { value: 'simple', label: 'Simple' },
  { value: 'metadata', label: 'Metadata' },
] as const;

type HunkSeparatorValue = (typeof HUNK_SEPARATOR_OPTIONS)[number]['value'];

// Default values for URL param comparison
const DEFAULTS = {
  diffStyle: 'split',
  themeType: 'system',
  lightTheme: 'pierre-light',
  darkTheme: 'pierre-dark',
  diffIndicators: 'bars',
  lineDiffType: 'word-alt',
  hunkSeparators: 'line-info' as HunkSeparatorValue,
  background: true,
  lineNumbers: true,
  wrap: true,
  lineSelection: true,
  hoverButton: true,
  interactionMode: 'comment' as const,
  annotations: true,
} as const;

interface PlaygroundClientProps {
  prerenderedDiff: PreloadFileDiffResult<PlaygroundAnnotationMetadata>;
}

interface PlaygroundControlsContentProps {
  diffStyle: 'split' | 'unified';
  setDiffStyle: (v: 'split' | 'unified') => void;
  themeType: 'system' | 'light' | 'dark';
  setThemeType: (v: 'system' | 'light' | 'dark') => void;
  selectedLightTheme: (typeof LIGHT_THEMES)[number];
  setSelectedLightTheme: (v: (typeof LIGHT_THEMES)[number]) => void;
  selectedDarkTheme: (typeof DARK_THEMES)[number];
  setSelectedDarkTheme: (v: (typeof DARK_THEMES)[number]) => void;
  diffIndicators: 'bars' | 'classic' | 'none';
  setDiffIndicators: (v: 'bars' | 'classic' | 'none') => void;
  lineDiffType: 'word-alt' | 'word' | 'char' | 'none';
  setLineDiffType: (v: 'word-alt' | 'word' | 'char' | 'none') => void;
  hunkSeparators: HunkSeparatorValue;
  setHunkSeparators: (v: HunkSeparatorValue) => void;
  disableBackground: boolean;
  setDisableBackground: (v: boolean) => void;
  disableLineNumbers: boolean;
  setDisableLineNumbers: (v: boolean) => void;
  overflow: 'wrap' | 'scroll';
  setOverflow: (v: 'wrap' | 'scroll') => void;
  enableLineSelection: boolean;
  setEnableLineSelection: (v: boolean) => void;
  enableHoverUtility: boolean;
  setEnableHoverUtility: (v: boolean) => void;
  showAnnotations: boolean;
  setShowAnnotations: (v: boolean) => void;
  selectedRange: SelectedLineRange | null;
  setSelectedRange: (v: SelectedLineRange | null) => void;
  handleCopyLink: () => void;
  hideShare?: boolean;
}

function PlaygroundControlsContent({
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
  hideShare = false,
}: PlaygroundControlsContentProps) {
  const interactionMode: 'select' | 'comment' | 'none' = enableHoverUtility
    ? 'comment'
    : enableLineSelection
      ? 'select'
      : 'none';
  const interactionModeOptions = [
    { value: 'select', label: 'Select lines' },
    { value: 'comment', label: 'Add comment' },
    { value: 'none', label: 'No line interactions' },
  ] as const;

  const setInteractionMode = (mode: 'select' | 'comment' | 'none') => {
    if (mode === 'comment') {
      setEnableHoverUtility(true);
      setEnableLineSelection(false);
      return;
    }
    if (mode === 'select') {
      setEnableLineSelection(true);
      setEnableHoverUtility(false);
      return;
    }
    setEnableLineSelection(false);
    setEnableHoverUtility(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ButtonGroup
          value={diffStyle}
          onValueChange={(value) => setDiffStyle(value as 'split' | 'unified')}
        >
          <ButtonGroupItem value="split">
            <IconDiffSplit />
          </ButtonGroupItem>
          <ButtonGroupItem value="unified">
            <IconDiffUnified />
          </ButtonGroupItem>
        </ButtonGroup>

        <div className="bg-border h-6 w-px" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="justify-start">
              <IconColorLight />
              {selectedLightTheme}
              <IconChevronSm className="text-muted-foreground ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" scrollSelectedIntoView>
            {LIGHT_THEMES.map((theme) => (
              <DropdownMenuItem
                key={theme}
                onClick={() => {
                  setSelectedLightTheme(theme);
                  setThemeType('light');
                }}
                selected={selectedLightTheme === theme}
              >
                {theme}
                {selectedLightTheme === theme && (
                  <IconCheck className="ml-auto" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="justify-start">
              <IconColorDark />
              {selectedDarkTheme}
              <IconChevronSm className="text-muted-foreground ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" scrollSelectedIntoView>
            {DARK_THEMES.map((theme) => (
              <DropdownMenuItem
                key={theme}
                onClick={() => {
                  setSelectedDarkTheme(theme);
                  setThemeType('dark');
                }}
                selected={selectedDarkTheme === theme}
              >
                {theme}
                {selectedDarkTheme === theme && (
                  <IconCheck className="ml-auto" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ButtonGroup
          value={themeType}
          onValueChange={(value) =>
            setThemeType(value as 'system' | 'light' | 'dark')
          }
        >
          <ButtonGroupItem value="system">
            <IconColorAuto />
          </ButtonGroupItem>
          <ButtonGroupItem value="light">
            <IconColorLight />
          </ButtonGroupItem>
          <ButtonGroupItem value="dark">
            <IconColorDark />
          </ButtonGroupItem>
        </ButtonGroup>

        <div className="bg-border h-6 w-px" />

        <ButtonGroup
          value={diffIndicators}
          onValueChange={(value) =>
            setDiffIndicators(value as 'bars' | 'classic' | 'none')
          }
        >
          <ButtonGroupItem value="bars">
            <IconCodeStyleBars />
          </ButtonGroupItem>
          <ButtonGroupItem value="classic">
            <IconSymbolDiffstat />
          </ButtonGroupItem>
          <ButtonGroupItem value="none">
            <IconParagraph />
          </ButtonGroupItem>
        </ButtonGroup>

        <div className="bg-border h-6 w-px" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="justify-start px-3">
              <IconCodeStyleInline />
              {LINE_DIFF_OPTIONS.find((opt) => opt.value === lineDiffType)
                ?.label ?? lineDiffType}
              <IconChevronSm className="text-muted-foreground ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" scrollSelectedIntoView>
            {LINE_DIFF_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setLineDiffType(option.value)}
                selected={lineDiffType === option.value}
              >
                {option.label}
                {lineDiffType === option.value && (
                  <IconCheck className="ml-auto" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {!hideShare && (
          <>
            <div className="bg-border h-6 w-px xl:hidden" />
            <Button
              variant="outline"
              onClick={handleCopyLink}
              className="xl:ms-auto"
            >
              <IconLink />
              Copy link
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ToggleButton
          icon={<IconCodeStyleBg />}
          label="Backgrounds"
          checked={!disableBackground}
          onCheckedChange={(checked) => setDisableBackground(!checked)}
        />
        <ToggleButton
          icon={<IconListOrdered />}
          label="Line numbers"
          checked={!disableLineNumbers}
          onCheckedChange={(checked) => setDisableLineNumbers(!checked)}
        />
        <ToggleButton
          icon={<IconWordWrap />}
          label="Wrap"
          checked={overflow === 'wrap'}
          onCheckedChange={(checked) =>
            setOverflow(checked ? 'wrap' : 'scroll')
          }
        />

        <ToggleButton
          icon={<IconInReview />}
          label="Annotations"
          checked={showAnnotations}
          onCheckedChange={setShowAnnotations}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="justify-start px-3">
              <IconHunkDivider />
              {HUNK_SEPARATOR_OPTIONS.find(
                (opt) => opt.value === hunkSeparators
              )?.label ?? hunkSeparators}
              <IconChevronSm className="text-muted-foreground ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" scrollSelectedIntoView>
            {HUNK_SEPARATOR_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setHunkSeparators(option.value)}
                selected={hunkSeparators === option.value}
              >
                {option.label}
                {hunkSeparators === option.value && (
                  <IconCheck className="ml-auto" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="justify-start px-3">
              <IconCursor />
              {interactionModeOptions.find(
                (opt) => opt.value === interactionMode
              )?.label ?? interactionMode}
              <IconChevronSm className="text-muted-foreground ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" scrollSelectedIntoView>
            {interactionModeOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setInteractionMode(option.value)}
                selected={interactionMode === option.value}
              >
                {option.label}
                {interactionMode === option.value && (
                  <IconCheck className="ml-auto" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {interactionMode === 'select' && (
          <>
            <div className="bg-border h-6 w-px" />

            <div className="bg-muted rounded-md px-3 py-1.5 font-mono text-[13px] tracking-tight">
              {selectedRange != null ? (
                <>
                  <span className="text-muted-foreground">Selected: </span>
                  <span className="font-semibold">
                    {selectedRange.start === selectedRange.end
                      ? `Line ${selectedRange.start} (${selectedRange.side})`
                      : `Lines ${selectedRange.start}–${selectedRange.end}`}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Nothing selected…</span>
              )}
            </div>
            {selectedRange != null ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedRange(null)}
                disabled={selectedRange == null}
              >
                <IconXSquircle className="text-muted-foreground" />
                Clear
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
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

  const getLineModeParam = (): 'select' | 'comment' | 'none' | null => {
    const value = searchParams.get('lineMode');
    if (value === 'select' || value === 'comment' || value === 'none') {
      return value;
    }
    return null;
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

  const initialLineMode = getLineModeParam();
  const [enableLineSelection, setEnableLineSelection] = useState(
    initialLineMode === 'select'
      ? true
      : initialLineMode === 'comment'
        ? false
        : initialLineMode === 'none'
          ? false
          : getBoolParam('select', DEFAULTS.lineSelection)
  );
  const [enableHoverUtility, setEnableHoverUtility] = useState(
    initialLineMode === 'comment'
      ? true
      : initialLineMode === 'select'
        ? false
        : initialLineMode === 'none'
          ? false
          : getBoolParam('hover', DEFAULTS.hoverButton)
  );
  const [showAnnotations, setShowAnnotations] = useState(
    getBoolParam('annot', DEFAULTS.annotations)
  );

  // Parse selected line range from URL
  // Format: L15a (line 15 additions), L28-35a (lines 28-35 additions), L10d (line 10 deletions)
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

  const interactionMode: 'select' | 'comment' | 'none' = enableHoverUtility
    ? 'comment'
    : enableLineSelection
      ? 'select'
      : 'none';

  // Build URL with current config
  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();

    // Only add non-default values to keep URL clean
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
    if (interactionMode !== DEFAULTS.interactionMode)
      params.set('lineMode', interactionMode);
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
    interactionMode,
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
    void navigator.clipboard.writeText(url).then(() => {
      toast.success('Link copied to clipboard');
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

  // Hover comments and line selection conflict on click targets.
  // Give hover comments precedence when both toggles are on.
  const canUseHoverComments = enableHoverUtility && !hasOpenCommentForm;
  const canSelectLines =
    enableLineSelection && !enableHoverUtility && !hasOpenCommentForm;

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

        {/* Desktop: full controls inline */}
        <div className="hidden md:block">
          <PlaygroundControlsContent {...controlsContentProps} />
        </div>

        {/* Mobile: drawer (backdrop + panel) */}
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
          enableLineSelection: canSelectLines,
          enableGutterUtility: canUseHoverComments,
          onLineSelectionEnd: handleLineSelectionEnd,
          onGutterUtilityClick: canUseHoverComments
            ? (range) => {
                if (range.side != null) {
                  addCommentAtLine(range.side, range.start);
                }
              }
            : undefined,
        }}
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

function ToggleButton({
  icon,
  label,
  checked,
  onCheckedChange,
}: {
  icon?: React.ReactNode;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="gridstack">
      <Button
        variant="outline"
        className="justify-between gap-3 pr-11 pl-3"
        onClick={() => onCheckedChange(!checked)}
      >
        <div className="flex items-center gap-2">
          {icon}
          {label}
        </div>
      </Button>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        onClick={(e) => e.stopPropagation()}
        className="pointer-events-none mr-3 place-self-center justify-self-end"
      />
    </div>
  );
}

function CommentForm({
  side,
  lineNumber,
  onCancel,
}: {
  side: AnnotationSide;
  lineNumber: number;
  onCancel: (side: AnnotationSide, lineNumber: number) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, []);

  const handleCancel = useCallback(() => {
    onCancel(side, lineNumber);
  }, [side, lineNumber, onCancel]);

  return (
    <div
      style={{
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'row',
        gap: 1,
      }}
    >
      <div style={{ width: '100%' }}>
        <div
          className="max-w-[95%] sm:max-w-[70%]"
          style={{
            whiteSpace: 'normal',
            margin: 10,
            fontFamily: 'Geist',
          }}
        >
          <div className="bg-card rounded-lg border p-3 shadow-[0_2px_4px_rgba(0,0,0,0.05)]">
            <div className="flex gap-2">
              <div className="relative -mt-0.5 flex-shrink-0">
                <Avatar className="h-6 w-6">
                  <AvatarImage src="/avatars/avatar_fat.jpg" alt="You" />
                  <AvatarFallback>Y</AvatarFallback>
                </Avatar>
              </div>
              <div className="flex-1">
                <textarea
                  ref={textareaRef}
                  placeholder="Leave a comment…"
                  className="text-foreground bg-background min-h-[60px] w-full resize-none rounded-md border p-2 text-sm focus:ring-2 focus:ring-offset-[-1px]"
                />
                <div className="mt-1 flex items-center gap-2">
                  <Button
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => {
                      console.log('Comment submitted at', side, lineNumber);
                      handleCancel();
                    }}
                  >
                    Comment
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCancel}
                    variant="outline"
                    style={{
                      boxShadow: 'none',
                      color: 'var(--color-foreground)',
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExampleThread() {
  return (
    <div
      className="max-w-[95%] sm:max-w-[70%]"
      style={{
        whiteSpace: 'normal',
        margin: 10,
        fontFamily: 'Geist',
      }}
    >
      <div className="bg-card rounded-lg border p-3 shadow-[0_2px_4px_rgba(0,0,0,0.05)]">
        <div className="flex gap-2">
          <div className="relative -mt-0.5 flex-shrink-0">
            <Avatar className="h-6 w-6">
              <AvatarImage src="/avatars/avatar_fat.jpg" alt="Author" />
              <AvatarFallback>A</AvatarFallback>
            </Avatar>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-foreground font-semibold">Alex</span>
              <span className="text-muted-foreground text-sm">2h ago</span>
            </div>
            <p className="text-foreground leading-relaxed">
              Should we add rate limiting to this endpoint? We might want to
              prevent abuse.
            </p>
          </div>
        </div>

        <div className="mt-4 ml-8 space-y-4">
          <div className="flex gap-2">
            <div className="relative -mt-0.5 flex-shrink-0">
              <Avatar className="h-6 w-6">
                <AvatarImage src="/avatars/avatar_mdo.jpg" alt="Author" />
                <AvatarFallback>M</AvatarFallback>
              </Avatar>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-foreground font-semibold">Mark</span>
                <span className="text-muted-foreground text-sm">1h ago</span>
              </div>
              <p className="text-foreground leading-relaxed">
                Good idea! I'll add that in a follow-up PR.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 ml-8 flex items-center gap-4">
          <button className="flex items-center gap-1.5 text-sm text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            Add reply…
          </button>
          <button className="text-sm text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            Resolve
          </button>
        </div>
      </div>
    </div>
  );
}
