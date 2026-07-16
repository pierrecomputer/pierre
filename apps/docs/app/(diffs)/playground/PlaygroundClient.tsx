'use client';

import type {
  AnnotationSide,
  CodeViewOptions,
  DiffIndicators,
  DiffLineAnnotation,
  FileDiffOptions,
  SelectedLineRange,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { EditProvider, FileDiff, useWorkerPool } from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import {
  IconCheck,
  IconChevronSm,
  IconCiWarning,
  IconCodeStyleBars,
  IconCodeStyleBg,
  IconCodeStyleInline,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
  IconCursor,
  IconDiffSplit,
  IconDiffUnified,
  IconEye,
  IconHunkDivider,
  IconInReview,
  IconLayers,
  IconLink,
  IconListOrdered,
  IconParagraph,
  IconPencil,
  IconSymbolDiffstat,
  IconWordWrap,
  IconXSquircle,
} from '@pierre/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { PlaygroundAnnotationMetadata } from './constants';
import {
  CODE_VIEW_ITEMS,
  ITEM_UNSAFE_CSS,
  PLAYGROUND_MARKERS,
  VIRTUALIZER_FILE_DIFFS,
} from './constants';
import { PlaygroundCodeView } from './PlaygroundCodeView';
import { CommentForm, ExampleThread } from './PlaygroundComments';
import { PlaygroundVirtualizerElementView } from './PlaygroundVirtualizerElementView';
import { PlaygroundVirtualizerView } from './PlaygroundVirtualizerView';
import { useTheme } from '@/components/theme-provider';
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
  'pierre-light-soft',
  'catppuccin-latte',
  'github-light',
  'one-light',
  'solarized-light',
] as const;

const DARK_THEMES = [
  'pierre-dark',
  'pierre-dark-soft',
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

const LINE_HOVER_HIGHLIGHT_OPTIONS = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'both', label: 'Line & number' },
  { value: 'number', label: 'Number' },
  { value: 'line', label: 'Line' },
] as const;

type LineHoverHighlight =
  (typeof LINE_HOVER_HIGHLIGHT_OPTIONS)[number]['value'];

// The editable surface is rendered read-only (Review) or attached to a live
// editor (Edit). Markers are diagnostics shown only while editing.
type EditorMode = 'review' | 'edit';

// The rendering surface the playground diff(s) are drawn with. 'normal' is the
// single editable FileDiff; 'virtualizer' renders several diffs with window
// scroll (vanilla Virtualizer); 'virtualizer-element' renders them with the
// React <Virtualizer> inside its own scroll region; 'codeview' renders a mix
// of diff/file items in CodeView's own scroller.
type ViewMode = 'normal' | 'virtualizer' | 'virtualizer-element' | 'codeview';

const VIEW_MODE_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'virtualizer', label: 'Virtualizer (win)' },
  { value: 'virtualizer-element', label: 'Virtualizer (el)' },
  { value: 'codeview', label: 'CodeView' },
] as const;

// Pure rendering options shared by all three view modes. These keys don't depend
// on the annotation metadata generic, so a single annotation-agnostic type keeps
// them assignable to FileDiff, VirtualizedFileDiff, and CodeView alike (spreading
// a `<undefined>`-typed options object into an annotated FileDiff would otherwise
// widen its annotation callbacks to `undefined`).
type SharedRenderOptions = Pick<
  FileDiffOptions<undefined>,
  | 'diffStyle'
  | 'diffIndicators'
  | 'lineDiffType'
  | 'lineHoverHighlight'
  | 'disableBackground'
  | 'disableLineNumbers'
  | 'overflow'
  | 'themeType'
  | 'theme'
> & {
  // The full `hunkSeparators` type includes an LAnnotation-typed render
  // callback; the playground only uses the string presets, so narrow it here to
  // stay annotation-agnostic.
  hunkSeparators: HunkSeparatorValue;
};

// Default values for URL param comparison
const DEFAULTS = {
  viewMode: 'normal' as ViewMode,
  diffStyle: 'split',
  colorMode: 'system',
  lightTheme: 'pierre-light',
  darkTheme: 'pierre-dark',
  diffIndicators: 'bars',
  lineDiffType: 'word-alt',
  lineHoverHighlight: 'disabled' as LineHoverHighlight,
  hunkSeparators: 'line-info' as HunkSeparatorValue,
  background: true,
  lineNumbers: true,
  wrap: true,
  lineSelection: true,
  gutterButton: true,
  interactionMode: 'comment' as const,
  annotations: true,
  editorMode: 'review' as EditorMode,
  markers: false,
} as const;

interface PlaygroundClientProps {
  prerenderedDiff: PreloadFileDiffResult<PlaygroundAnnotationMetadata>;
}

interface PlaygroundControlsContentProps {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  diffStyle: 'split' | 'unified';
  setDiffStyle: (v: 'split' | 'unified') => void;
  colorMode: 'system' | 'light' | 'dark';
  setColorMode: (v: 'system' | 'light' | 'dark') => void;
  selectedLightTheme: (typeof LIGHT_THEMES)[number];
  setSelectedLightTheme: (v: (typeof LIGHT_THEMES)[number]) => void;
  selectedDarkTheme: (typeof DARK_THEMES)[number];
  setSelectedDarkTheme: (v: (typeof DARK_THEMES)[number]) => void;
  diffIndicators: DiffIndicators;
  setDiffIndicators: (v: DiffIndicators) => void;
  lineDiffType: 'word-alt' | 'word' | 'char' | 'none';
  setLineDiffType: (v: 'word-alt' | 'word' | 'char' | 'none') => void;
  lineHoverHighlight: LineHoverHighlight;
  setLineHoverHighlight: (v: LineHoverHighlight) => void;
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
  enableGutterUtility: boolean;
  setEnableGutterUtility: (v: boolean) => void;
  showAnnotations: boolean;
  setShowAnnotations: (v: boolean) => void;
  editorMode: EditorMode;
  setEditorMode: (v: EditorMode) => void;
  showMarkers: boolean;
  setShowMarkers: (v: boolean) => void;
  selectedRange: SelectedLineRange | null;
  setSelectedRange: (v: SelectedLineRange | null) => void;
  handleCopyLink: () => void;
  hideShare?: boolean;
  // In the mobile drawer the dropdowns portal to <body> beneath the drawer
  // (z-60), so callers pass a higher z-index class to lift menus above it.
  dropdownContentClassName?: string;
}

function PlaygroundControlsContent({
  viewMode,
  setViewMode,
  diffStyle,
  setDiffStyle,
  colorMode,
  setColorMode,
  selectedLightTheme,
  setSelectedLightTheme,
  selectedDarkTheme,
  setSelectedDarkTheme,
  diffIndicators,
  setDiffIndicators,
  lineDiffType,
  setLineDiffType,
  lineHoverHighlight,
  setLineHoverHighlight,
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
  enableGutterUtility,
  setEnableGutterUtility,
  showAnnotations,
  setShowAnnotations,
  editorMode,
  setEditorMode,
  showMarkers,
  setShowMarkers,
  selectedRange,
  setSelectedRange,
  handleCopyLink,
  hideShare = false,
  dropdownContentClassName,
}: PlaygroundControlsContentProps) {
  const interactionMode: 'select' | 'comment' | 'none' = enableGutterUtility
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
      setEnableGutterUtility(true);
      setEnableLineSelection(false);
      return;
    }
    if (mode === 'select') {
      setEnableLineSelection(true);
      setEnableGutterUtility(false);
      return;
    }
    setEnableLineSelection(false);
    setEnableGutterUtility(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="justify-start px-3">
              <IconLayers />
              {VIEW_MODE_OPTIONS.find((opt) => opt.value === viewMode)?.label ??
                viewMode}
              <IconChevronSm className="text-muted-foreground ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            scrollSelectedIntoView
            className={dropdownContentClassName}
          >
            {VIEW_MODE_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setViewMode(option.value)}
                selected={viewMode === option.value}
              >
                {option.label}
                {viewMode === option.value && <IconCheck className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="bg-border h-6 w-px" />

        <ButtonGroup
          value={diffStyle}
          onValueChange={(value) => setDiffStyle(value as 'split' | 'unified')}
          size="icon"
        >
          <ButtonGroupItem value="split">
            <IconDiffSplit />
          </ButtonGroupItem>
          <ButtonGroupItem value="unified">
            <IconDiffUnified />
          </ButtonGroupItem>
        </ButtonGroup>

        {/*
          The single global Edit toggle only makes sense for the one-file Normal
          view. Virtualizer/CodeView show a per-file edit control in each header
          instead (Virtualizer today; CodeView is read-only for now).
        */}
        {viewMode === 'normal' && (
          <>
            <div className="bg-border h-6 w-px" />

            <ButtonGroup
              value={editorMode}
              onValueChange={(value) => setEditorMode(value as EditorMode)}
              aria-label="Editor mode"
              size="icon"
            >
              <ButtonGroupItem value="review">
                <IconEye />
              </ButtonGroupItem>
              <ButtonGroupItem value="edit">
                <IconPencil />
              </ButtonGroupItem>
            </ButtonGroup>
          </>
        )}

        <div className="bg-border h-6 w-px" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="justify-start">
              <IconColorLight />
              {selectedLightTheme}
              <IconChevronSm className="text-muted-foreground ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            scrollSelectedIntoView
            className={dropdownContentClassName}
          >
            {LIGHT_THEMES.map((theme) => (
              <DropdownMenuItem
                key={theme}
                onClick={() => {
                  setSelectedLightTheme(theme);
                  setColorMode('light');
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
          <DropdownMenuContent
            align="start"
            scrollSelectedIntoView
            className={dropdownContentClassName}
          >
            {DARK_THEMES.map((theme) => (
              <DropdownMenuItem
                key={theme}
                onClick={() => {
                  setSelectedDarkTheme(theme);
                  setColorMode('dark');
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
          value={colorMode}
          onValueChange={(value) =>
            setColorMode(value as 'system' | 'light' | 'dark')
          }
          size="icon"
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
          onValueChange={(value) => setDiffIndicators(value as DiffIndicators)}
          size="icon"
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
          <DropdownMenuContent
            align="start"
            scrollSelectedIntoView
            className={dropdownContentClassName}
          >
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

        {/* Markers come from the global editor, which only exists in Normal. */}
        {viewMode === 'normal' && (
          <ToggleButton
            icon={<IconCiWarning />}
            label="Markers"
            checked={showMarkers}
            onCheckedChange={setShowMarkers}
            // Markers require an attached editor, so they only apply in Edit mode.
            disabled={editorMode !== 'edit'}
            title={
              editorMode !== 'edit'
                ? 'Switch to Edit mode to show lint markers'
                : undefined
            }
          />
        )}

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
          <DropdownMenuContent
            align="start"
            scrollSelectedIntoView
            className={dropdownContentClassName}
          >
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
              <IconEye />
              Line hover:{' '}
              {LINE_HOVER_HIGHLIGHT_OPTIONS.find(
                (option) => option.value === lineHoverHighlight
              )?.label ?? lineHoverHighlight}
              <IconChevronSm className="text-muted-foreground ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            scrollSelectedIntoView
            className={dropdownContentClassName}
          >
            {LINE_HOVER_HIGHLIGHT_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setLineHoverHighlight(option.value)}
                selected={lineHoverHighlight === option.value}
              >
                {option.label}
                {lineHoverHighlight === option.value && (
                  <IconCheck className="ml-auto" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="bg-border h-6 w-px" />

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
          <DropdownMenuContent
            align="start"
            scrollSelectedIntoView
            className={dropdownContentClassName}
          >
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

  // The app-wide color scheme resolved by @pierre/theming (the shared theme
  // controller). The diff's "system" mode must follow this so the editor stays
  // in sync with the rest of the app. See `effectiveColorMode`.
  const { resolvedColorScheme } = useTheme();

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

  const getLineHoverHighlightParam = (): LineHoverHighlight => {
    const value = searchParams.get('hover');
    return (
      LINE_HOVER_HIGHLIGHT_OPTIONS.find((option) => option.value === value)
        ?.value ?? DEFAULTS.lineHoverHighlight
    );
  };

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const value = getParam('view', DEFAULTS.viewMode);
    return value === 'virtualizer' ||
      value === 'virtualizer-element' ||
      value === 'codeview'
      ? value
      : 'normal';
  });

  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(
    getParam('layout', DEFAULTS.diffStyle) as 'split' | 'unified'
  );

  const [colorMode, setColorMode] = useState<'system' | 'light' | 'dark'>(
    getParam('mode', DEFAULTS.colorMode) as 'system' | 'light' | 'dark'
  );
  const [selectedLightTheme, setSelectedLightTheme] = useState<
    (typeof LIGHT_THEMES)[number]
  >(getParam('light', DEFAULTS.lightTheme) as (typeof LIGHT_THEMES)[number]);
  const [selectedDarkTheme, setSelectedDarkTheme] = useState<
    (typeof DARK_THEMES)[number]
  >(getParam('dark', DEFAULTS.darkTheme) as (typeof DARK_THEMES)[number]);

  const [diffIndicators, setDiffIndicators] = useState<DiffIndicators>(
    getParam('indicators', DEFAULTS.diffIndicators) as DiffIndicators
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

  const [lineHoverHighlight, setLineHoverHighlight] =
    useState<LineHoverHighlight>(getLineHoverHighlightParam);

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
  const [enableGutterUtility, setEnableGutterUtility] = useState(
    initialLineMode === 'comment'
      ? true
      : initialLineMode === 'select'
        ? false
        : initialLineMode === 'none'
          ? false
          : getBoolParam('gutter', DEFAULTS.gutterButton)
  );
  const [showAnnotations, setShowAnnotations] = useState(
    getBoolParam('annot', DEFAULTS.annotations)
  );
  // Edit mode only exists in the Normal view (other views render per-file
  // edit controls instead), so only honor `?edit=edit` when starting there.
  const [editorMode, setEditorMode] = useState<EditorMode>(
    viewMode === 'normal' && getParam('edit', DEFAULTS.editorMode) === 'edit'
      ? 'edit'
      : 'review'
  );
  const [showMarkers, setShowMarkers] = useState(
    getBoolParam('markers', DEFAULTS.markers)
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
  // Keep URL updates at gesture boundaries instead of navigating on every
  // pointer move while the controlled selection follows a gutter drag.
  const [committedSelectedRange, setCommittedSelectedRange] =
    useState(selectedRange);
  const [annotations, setAnnotations] = useState<
    DiffLineAnnotation<PlaygroundAnnotationMetadata>[]
  >(prerenderedDiff.annotations ?? []);

  const interactionMode: 'select' | 'comment' | 'none' = enableGutterUtility
    ? 'comment'
    : enableLineSelection
      ? 'select'
      : 'none';

  const contentEditable = editorMode === 'edit';

  // The editor attaches to the diff's editable (new-file) side. Recreate it
  // when the diff layout or edit mode changes so it re-attaches to the freshly
  // relaid-out surface with a clean document instead of reusing a torn-down
  // instance (mirrors LiveEditing's editor lifecycle).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps intentionally force a fresh editor; the factory takes no inputs
  const editor = useMemo(() => new Editor({}), []);

  // Apply (or clear) the demo markers whenever the editor, mode, or toggle
  // changes. `setMarkers` throws until the editor attaches to its surface
  // (async), so retry each frame until the call sticks (mirrors MarkerDemo).
  useEffect(() => {
    if (!contentEditable) {
      return;
    }
    let frame = 0;
    const apply = () => {
      try {
        editor.setMarkers(showMarkers ? PLAYGROUND_MARKERS : []);
      } catch {
        frame = requestAnimationFrame(apply);
      }
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [editor, contentEditable, showMarkers]);

  // Build URL with current config
  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();

    // Only add non-default values to keep URL clean
    if (viewMode !== DEFAULTS.viewMode) params.set('view', viewMode);
    if (diffStyle !== DEFAULTS.diffStyle) params.set('layout', diffStyle);
    if (colorMode !== DEFAULTS.colorMode) params.set('mode', colorMode);
    if (selectedLightTheme !== DEFAULTS.lightTheme)
      params.set('light', selectedLightTheme);
    if (selectedDarkTheme !== DEFAULTS.darkTheme)
      params.set('dark', selectedDarkTheme);
    if (diffIndicators !== DEFAULTS.diffIndicators)
      params.set('indicators', diffIndicators);
    if (lineDiffType !== DEFAULTS.lineDiffType)
      params.set('inline', lineDiffType);
    if (lineHoverHighlight !== DEFAULTS.lineHoverHighlight)
      params.set('hover', lineHoverHighlight);
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
    if (enableGutterUtility !== DEFAULTS.gutterButton)
      params.set('gutter', enableGutterUtility ? '1' : '0');
    if (showAnnotations !== DEFAULTS.annotations)
      params.set('annot', showAnnotations ? '1' : '0');
    if (editorMode !== DEFAULTS.editorMode) params.set('edit', editorMode);
    if (showMarkers !== DEFAULTS.markers)
      params.set('markers', showMarkers ? '1' : '0');

    if (committedSelectedRange != null) {
      const sideChar = committedSelectedRange.side === 'deletions' ? 'd' : 'a';
      const lineValue =
        committedSelectedRange.start === committedSelectedRange.end
          ? `${committedSelectedRange.start}${sideChar}`
          : `${committedSelectedRange.start}-${committedSelectedRange.end}${sideChar}`;
      params.set('line', lineValue);
    }

    const queryString = params.toString();
    return queryString.length > 0
      ? `/playground?${queryString}`
      : '/playground';
  }, [
    viewMode,
    diffStyle,
    colorMode,
    selectedLightTheme,
    selectedDarkTheme,
    diffIndicators,
    lineDiffType,
    lineHoverHighlight,
    hunkSeparators,
    disableBackground,
    disableLineNumbers,
    overflow,
    interactionMode,
    enableLineSelection,
    enableGutterUtility,
    showAnnotations,
    editorMode,
    showMarkers,
    committedSelectedRange,
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

  const handleLineSelectionChange = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
    },
    []
  );

  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
      setCommittedSelectedRange(range);
    },
    []
  );

  const addCommentAtRange = useCallback((range: SelectedLineRange) => {
    const side = range.endSide ?? range.side;
    if (side == null) {
      return;
    }
    const lineNumber = range.end;
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
  }, []);

  const handleCancelComment = useCallback(
    (side: AnnotationSide | undefined, lineNumber: number) => {
      setAnnotations((prev) =>
        prev.filter(
          (ann) => !(ann.side === side && ann.lineNumber === lineNumber)
        )
      );
      setSelectedRange(null);
      setCommittedSelectedRange(null);
    },
    []
  );

  const hasOpenCommentForm = annotations.some(
    (ann) => ann.metadata.isThread !== true
  );

  // The controls expose standalone selection and comments as separate modes.
  // Comment mode still tracks a selected range for the gutter utility gesture.
  const canUseGutterComments = enableGutterUtility && !hasOpenCommentForm;
  const canSelectLines =
    enableLineSelection && !enableGutterUtility && !hasOpenCommentForm;

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

  // Leaving the Normal view drops back to Review: the global Edit toggle only
  // exists there, and a stale 'edit' would keep `contentEditable` true with no
  // mounted editor to attach to, so the marker effect would retry forever.
  const setViewModeAndResetEditor = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (mode !== 'normal') setEditorMode('review');
  }, []);

  const controlsContentProps = {
    viewMode,
    setViewMode: setViewModeAndResetEditor,
    diffStyle,
    setDiffStyle,
    colorMode,
    setColorMode,
    selectedLightTheme,
    setSelectedLightTheme,
    selectedDarkTheme,
    setSelectedDarkTheme,
    diffIndicators,
    setDiffIndicators,
    lineDiffType,
    setLineDiffType,
    lineHoverHighlight,
    setLineHoverHighlight,
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
    enableGutterUtility,
    setEnableGutterUtility,
    showAnnotations,
    setShowAnnotations,
    editorMode,
    setEditorMode,
    showMarkers,
    setShowMarkers,
    selectedRange,
    setSelectedRange: handleLineSelectionEnd,
    handleCopyLink,
  };

  // The diff's own "system" mode follows the OS (its shadow root declares
  // `color-scheme: light dark`), which drifts from the app whenever the app's
  // theme differs from the OS preference. To keep the editor in sync with the
  // app, resolve "system" to the app's current scheme from @pierre/theming and
  // pass that concrete light/dark to the diff; "light"/"dark" still force the
  // editor independently. Before the controller has mounted
  // `resolvedColorScheme` is undefined, so fall back to "system" to match the
  // prerendered diff.
  const effectiveColorMode =
    colorMode === 'system' ? (resolvedColorScheme ?? 'system') : colorMode;

  // Pure rendering options shared by all three view modes. Interaction and
  // edit-specific options are layered on per surface below.
  const renderOptions = useMemo<SharedRenderOptions>(
    () => ({
      diffStyle,
      diffIndicators,
      lineDiffType,
      lineHoverHighlight,
      hunkSeparators,
      disableBackground,
      disableLineNumbers,
      overflow,
      themeType: effectiveColorMode,
      theme: { dark: selectedDarkTheme, light: selectedLightTheme },
    }),
    [
      diffStyle,
      diffIndicators,
      lineDiffType,
      lineHoverHighlight,
      hunkSeparators,
      disableBackground,
      disableLineNumbers,
      overflow,
      effectiveColorMode,
      selectedDarkTheme,
      selectedLightTheme,
    ]
  );

  // With a worker pool, highlight render options (theme, line-diff granularity)
  // are pool-global — the workers render with the pool's config, not each
  // component's options — so picker changes must be pushed into the pool.
  // setRenderOptions no-ops when nothing changed, re-resolves themes, updates
  // every worker, drops stale AST caches, and notifies mounted instances.
  const workerPool = useWorkerPool();
  useEffect(() => {
    void workerPool?.setRenderOptions({
      theme: renderOptions.theme,
      lineDiffType: renderOptions.lineDiffType,
    });
  }, [workerPool, renderOptions.theme, renderOptions.lineDiffType]);

  // CodeView adds its own layout/sticky-header options on top of the shared
  // rendering options; its scrollbar styling mirrors the Normal view's.
  const codeViewOptions = useMemo<
    CodeViewOptions<PlaygroundAnnotationMetadata>
  >(
    () => ({
      ...renderOptions,
      stickyHeaders: true,
      layout: { paddingTop: 0, paddingBottom: 0, gap: 1 },
      unsafeCSS: ITEM_UNSAFE_CSS,
    }),
    [renderOptions]
  );

  const fileDiff = (
    <FileDiff
      {...prerenderedDiff}
      className="border-border overflow-hidden rounded-lg border"
      contentEditable={contentEditable}
      selectedLines={selectedRange}
      lineAnnotations={showAnnotations ? annotations : []}
      options={{
        ...prerenderedDiff.options,
        ...renderOptions,
        enableLineSelection: canSelectLines,
        enableGutterUtility: canUseGutterComments,
        onLineSelectionStart: handleLineSelectionChange,
        onLineSelectionChange: handleLineSelectionChange,
        onLineSelectionEnd: handleLineSelectionEnd,
        onGutterUtilityClick: canUseGutterComments
          ? (range) => {
              addCommentAtRange(range);
            }
          : undefined,
      }}
      renderAnnotation={
        showAnnotations
          ? (annotation) =>
              annotation.metadata.isThread === true ? (
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
  );

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
            className={`mobile-popover ${isControlsOpen ? 'is-open' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-medium">Options</span>
              <Button variant="ghost" size="sm" onClick={closeControls}>
                Close
              </Button>
            </div>
            <PlaygroundControlsContent
              {...controlsContentProps}
              hideShare
              dropdownContentClassName="z-[70]"
            />
          </div>
        </div>
      </div>

      {/*
        Normal view keeps EditProvider mounted in both Review and Edit so
        toggling modes only flips `contentEditable` (the editor attaches lazily
        when that turns true). Conditionally wrapping would change the child
        component type and remount FileDiff, which recreates the shadow root and
        re-injects the dark SSR HTML for a frame — the light->dark flash we're
        avoiding here. Mirrors the LiveEditing demo.
      */}
      {viewMode === 'normal' ? (
        <EditProvider editor={editor}>{fileDiff}</EditProvider>
      ) : viewMode === 'virtualizer' ? (
        <PlaygroundVirtualizerView
          diffs={VIRTUALIZER_FILE_DIFFS}
          options={renderOptions}
          enableLineSelection={enableLineSelection}
          enableGutterComments={enableGutterUtility}
          showAnnotations={showAnnotations}
        />
      ) : viewMode === 'virtualizer-element' ? (
        <PlaygroundVirtualizerElementView
          diffs={VIRTUALIZER_FILE_DIFFS}
          options={renderOptions}
          enableLineSelection={enableLineSelection}
          enableGutterComments={enableGutterUtility}
          showAnnotations={showAnnotations}
        />
      ) : (
        <PlaygroundCodeView
          items={CODE_VIEW_ITEMS}
          options={codeViewOptions}
          enableLineSelection={enableLineSelection}
          enableGutterComments={enableGutterUtility}
          showAnnotations={showAnnotations}
        />
      )}
    </div>
  );
}

function ToggleButton({
  icon,
  label,
  checked,
  onCheckedChange,
  disabled = false,
  title,
}: {
  icon?: React.ReactNode;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <div className="gridstack" title={title}>
      <Button
        variant="outline"
        className="justify-between gap-3 pr-11 pl-3"
        disabled={disabled}
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
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        className="pointer-events-none mr-3 place-self-center justify-self-end"
      />
    </div>
  );
}
