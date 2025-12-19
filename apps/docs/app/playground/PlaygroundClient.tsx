'use client';

import {
  IconCheck,
  IconChevronSm,
  IconCodeStyleBars,
  IconCodeStyleBg,
  IconCodeStyleInline,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
  IconDiffSplit,
  IconDiffUnified,
  IconLink,
  IconListOrdered,
  IconParagraph,
  IconPlus,
  IconSymbolDiffstat,
  IconWordWrap,
  IconXSquircle,
} from '@/components/icons';
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
import type {
  AnnotationSide,
  DiffLineAnnotation,
  GetHoveredLineResult,
  SelectedLineRange,
} from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { PlaygroundAnnotationMetadata } from './constants';

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

// Default values for URL param comparison
const DEFAULTS = {
  diffStyle: 'split',
  themeType: 'system',
  lightTheme: 'pierre-light',
  darkTheme: 'pierre-dark',
  diffIndicators: 'bars',
  lineDiffType: 'word-alt',
  background: true,
  lineNumbers: true,
  wrap: true,
  lineSelection: true,
  hoverButton: true,
  annotations: true,
} as const;

interface PlaygroundClientProps {
  prerenderedDiff: PreloadFileDiffResult<PlaygroundAnnotationMetadata>;
}

export function PlaygroundClient({ prerenderedDiff }: PlaygroundClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Parse URL params with defaults
  const getParam = <T extends string>(key: string, defaultValue: T): T => {
    return (searchParams.get(key) as T) ?? defaultValue;
  };

  const getBoolParam = (key: string, defaultValue: boolean): boolean => {
    const value = searchParams.get(key);
    if (value === null) return defaultValue;
    return value === '1' || value === 'true';
  };

  // Layout
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(
    getParam('layout', DEFAULTS.diffStyle) as 'split' | 'unified'
  );

  // Theme
  const [themeType, setThemeType] = useState<'system' | 'light' | 'dark'>(
    getParam('mode', DEFAULTS.themeType) as 'system' | 'light' | 'dark'
  );
  const [selectedLightTheme, setSelectedLightTheme] = useState<
    (typeof LIGHT_THEMES)[number]
  >(getParam('light', DEFAULTS.lightTheme) as (typeof LIGHT_THEMES)[number]);
  const [selectedDarkTheme, setSelectedDarkTheme] = useState<
    (typeof DARK_THEMES)[number]
  >(getParam('dark', DEFAULTS.darkTheme) as (typeof DARK_THEMES)[number]);

  // Diff indicators
  const [diffIndicators, setDiffIndicators] = useState<
    'bars' | 'classic' | 'none'
  >(
    getParam('indicators', DEFAULTS.diffIndicators) as
      | 'bars'
      | 'classic'
      | 'none'
  );

  // Line diff type
  const [lineDiffType, setLineDiffType] = useState<
    'word-alt' | 'word' | 'char' | 'none'
  >(
    getParam('inline', DEFAULTS.lineDiffType) as
      | 'word-alt'
      | 'word'
      | 'char'
      | 'none'
  );

  // Visual options
  const [disableBackground, setDisableBackground] = useState(
    !getBoolParam('bg', DEFAULTS.background)
  );
  const [disableLineNumbers, setDisableLineNumbers] = useState(
    !getBoolParam('ln', DEFAULTS.lineNumbers)
  );
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>(
    getBoolParam('wrap', DEFAULTS.wrap) ? 'wrap' : 'scroll'
  );

  // Interactive features
  const [enableLineSelection, setEnableLineSelection] = useState(
    getBoolParam('select', DEFAULTS.lineSelection)
  );
  const [enableHoverUtility, setEnableHoverUtility] = useState(
    getBoolParam('hover', DEFAULTS.hoverButton)
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

    // Add selected line range
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
    disableBackground,
    disableLineNumbers,
    overflow,
    enableLineSelection,
    enableHoverUtility,
    showAnnotations,
    selectedRange,
  ]);

  // Sync URL when state changes
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

  return (
    <div className="space-y-6">
      {/* Controls Panel */}
      <div className="space-y-4">
        {/* Row 1: Layout & Theme */}
        <div className="flex flex-wrap items-center gap-3">
          <ButtonGroup
            value={diffStyle}
            onValueChange={(value) =>
              setDiffStyle(value as 'split' | 'unified')
            }
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
            <DropdownMenuContent align="start">
              {LIGHT_THEMES.map((theme) => (
                <DropdownMenuItem
                  key={theme}
                  onClick={() => {
                    setSelectedLightTheme(theme);
                    setThemeType('light');
                  }}
                  className={
                    selectedLightTheme === theme ? 'bg-accent' : undefined
                  }
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
            <DropdownMenuContent align="start">
              {DARK_THEMES.map((theme) => (
                <DropdownMenuItem
                  key={theme}
                  onClick={() => {
                    setSelectedDarkTheme(theme);
                    setThemeType('dark');
                  }}
                  className={
                    selectedDarkTheme === theme ? 'bg-accent' : undefined
                  }
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
              <Button variant="outline" className="justify-start">
                <IconCodeStyleInline />
                {LINE_DIFF_OPTIONS.find((opt) => opt.value === lineDiffType)
                  ?.label ?? lineDiffType}
                <IconChevronSm className="text-muted-foreground ml-auto" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {LINE_DIFF_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => setLineDiffType(option.value)}
                  className={
                    lineDiffType === option.value ? 'bg-accent' : undefined
                  }
                >
                  {option.label}
                  {lineDiffType === option.value && (
                    <IconCheck className="ml-auto" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="bg-border h-6 w-px md:hidden" />

          <Button
            variant="outline"
            onClick={handleCopyLink}
            className="md:ms-auto"
          >
            <IconLink />
            Share
          </Button>
        </div>

        {/* Row 3: Visual Toggles */}
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

          <div className="bg-border h-6 w-px" />

          <ToggleButton
            label="Line Selection"
            checked={enableLineSelection}
            onCheckedChange={setEnableLineSelection}
          />
          <ToggleButton
            label="Hover Button"
            checked={enableHoverUtility}
            onCheckedChange={setEnableHoverUtility}
          />
          <ToggleButton
            label="Annotations"
            checked={showAnnotations}
            onCheckedChange={setShowAnnotations}
          />
        </div>

        {/* Row 4: Selection State */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-background rounded-md border px-3 py-1.5 font-mono text-sm">
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
              <span className="text-muted-foreground">No selection</span>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedRange({ start: 15, side: 'additions', end: 15 });
            }}
          >
            Select line 15
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedRange({
                start: 28,
                side: 'additions',
                end: 35,
              });
            }}
          >
            Select lines 28-35
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedRange(null)}
            disabled={selectedRange == null}
          >
            <IconXSquircle className="text-muted-foreground" />
            Clear
          </Button>

          <div className="bg-border h-6 w-px" />

          <Button
            variant="outline"
            size="sm"
            onClick={() => addCommentAtLine('additions', 25)}
          >
            Add comment at line 25
          </Button>
        </div>
      </div>

      {/* FileDiff Component */}
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

function HoverButton({
  getHoveredLine,
  onAddComment,
}: {
  getHoveredLine: () => GetHoveredLineResult<'diff'> | undefined;
  onAddComment: (side: AnnotationSide, lineNumber: number) => void;
}) {
  return (
    <Button
      size="icon-sm"
      variant="default"
      style={{
        backgroundColor: '#1a76d4',
        transition: 'none',
        cursor: 'pointer',
      }}
      onClick={(event) => {
        const hoveredLine = getHoveredLine();
        if (hoveredLine == null) return;
        event.stopPropagation();
        onAddComment(hoveredLine.side, hoveredLine.lineNumber);
      }}
    >
      <IconPlus />
    </Button>
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
            margin: 20,
            fontFamily: 'Geist',
          }}
        >
          <div className="bg-card rounded-lg border p-5 shadow-sm">
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
                  placeholder="Leave a comment"
                  className="text-foreground bg-background focus:ring-ring min-h-[60px] w-full resize-none rounded-md border p-2 text-sm focus:ring-2 focus:outline-none"
                />
                <div className="mt-3 flex items-center gap-2">
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
                  <button
                    onClick={handleCancel}
                    className="text-muted-foreground hover:text-foreground cursor-pointer px-3 py-1 text-sm transition-colors"
                  >
                    Cancel
                  </button>
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
        margin: 20,
        fontFamily: 'Geist',
      }}
    >
      <div className="bg-card rounded-lg border p-5 shadow-sm">
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
            Add reply...
          </button>
          <button className="text-sm text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            Resolve
          </button>
        </div>
      </div>
    </div>
  );
}
