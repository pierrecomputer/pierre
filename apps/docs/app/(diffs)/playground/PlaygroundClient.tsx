'use client';

import {
  type AnnotationSide,
  type DiffIndicators,
  type DiffLineAnnotation,
  type FileDiffOptions,
  isDiffAnnotationCollection,
  type SelectedLineRange,
} from '@pierre/diffs';
import type { Editor, EditorOptions } from '@pierre/diffs/editor';
import {
  type CodeViewReactOptions,
  FileDiff,
  useStableCallback,
  useWorkerPool,
} from '@pierre/diffs/react';
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';

import type { PlaygroundAnnotationMetadata } from './constants';
import {
  CODE_VIEW_ITEMS,
  ITEM_UNSAFE_CSS,
  PLAYGROUND_MARKERS,
  VIRTUALIZER_FILE_DIFFS,
} from './constants';
import { PlaygroundCodeView } from './PlaygroundCodeView';
import {
  CommentForm,
  CommentThread,
  ExampleThread,
} from './PlaygroundComments';
import { PlaygroundVirtualizerElementView } from './PlaygroundVirtualizerElementView';
import { PlaygroundVirtualizerView } from './PlaygroundVirtualizerView';
import type {
  HunkSeparatorValue,
  LineHoverHighlight,
  Mode,
  ViewMode,
} from './searchParams';
import {
  DARK_THEMES,
  DEFAULTS,
  LIGHT_THEMES,
  parsePlaygroundSearchParams,
} from './searchParams';
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

const LINE_HOVER_HIGHLIGHT_OPTIONS = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'both', label: 'Line & number' },
  { value: 'number', label: 'Number' },
  { value: 'line', label: 'Line' },
] as const;

const VIEW_MODE_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'virtualizer', label: 'Virtualizer (win)' },
  { value: 'virtualizer-element', label: 'Virtualizer (el)' },
  { value: 'codeview', label: 'CodeView' },
] as const;

const EMPTY_ANNOTATIONS: DiffLineAnnotation<PlaygroundAnnotationMetadata>[] =
  [];

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
  mode: Mode;
  setMode: (v: Mode) => void;
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
  mode,
  setMode,
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
          The single global Edit toggle only makes sense for the one-file
          Normal view. Virtualizer/CodeView show a per-file edit control in
          each header instead.
        */}
        {viewMode === 'normal' && (
          <>
            <div className="bg-border h-6 w-px" />

            <ButtonGroup
              value={mode}
              onValueChange={(value) => setMode(value as Mode)}
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

        {/* Markers use the Normal view's active edit-session editor. */}
        {viewMode === 'normal' && (
          <ToggleButton
            icon={<IconCiWarning />}
            label="Markers"
            checked={showMarkers}
            onCheckedChange={setShowMarkers}
            // Markers require an attached editor, so they only apply in Edit mode.
            disabled={mode !== 'edit'}
            title={
              mode !== 'edit'
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

  // One-time parse of the querystring with the same parser the server used to
  // build the prerendered payload, so the first client render agrees with the
  // prerendered markup.
  const [urlState] = useState(() =>
    parsePlaygroundSearchParams((key) => searchParams.get(key))
  );

  const [viewMode, setViewMode] = useState<ViewMode>(urlState.viewMode);
  const [diffStyle, setDiffStyle] = useState(urlState.diffStyle);
  const [colorMode, setColorMode] = useState(urlState.colorMode);
  const [selectedLightTheme, setSelectedLightTheme] = useState(
    urlState.lightTheme
  );
  const [selectedDarkTheme, setSelectedDarkTheme] = useState(
    urlState.darkTheme
  );
  const [diffIndicators, setDiffIndicators] = useState(urlState.diffIndicators);
  const [lineDiffType, setLineDiffType] = useState(urlState.lineDiffType);
  const [lineHoverHighlight, setLineHoverHighlight] = useState(
    urlState.lineHoverHighlight
  );
  const [hunkSeparators, setHunkSeparators] = useState(urlState.hunkSeparators);
  const [disableBackground, setDisableBackground] = useState(
    urlState.disableBackground
  );
  const [disableLineNumbers, setDisableLineNumbers] = useState(
    urlState.disableLineNumbers
  );
  const [overflow, setOverflow] = useState(urlState.overflow);
  const [enableLineSelection, setEnableLineSelection] = useState(
    urlState.enableLineSelection
  );
  const [enableGutterUtility, setEnableGutterUtility] = useState(
    urlState.enableGutterUtility
  );
  const [showAnnotations, setShowAnnotations] = useState(
    urlState.showAnnotations
  );
  const [mode, setMode] = useState<Mode>(urlState.mode);
  const [showMarkers, setShowMarkers] = useState(urlState.showMarkers);
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(
    urlState.selectedRange
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

  const edit = mode === 'edit';

  // Edits remap annotation line numbers (an Enter above a comment shifts it
  // down); onChange hands the remapped set back so the `lineAnnotations` prop
  // — and the React-slotted comment content keyed by line number — follows the
  // edit. The flushSync matters: the editor renamed the shadow-DOM annotation
  // slots during this same keystroke, and until React commits the matching
  // light-DOM `slot` attributes the comments project nowhere. A scheduled
  // commit lands frames later (blank comments, collapsed rows); a synchronous
  // one lands before this task's paint.
  const editorRef = useRef<Editor<PlaygroundAnnotationMetadata> | null>(null);
  const editOptions = useMemo<EditorOptions<PlaygroundAnnotationMetadata>>(
    () => ({
      onAttach(editor: Editor<PlaygroundAnnotationMetadata>) {
        editorRef.current = editor;
      },
      onChange: (_file, lineAnnotations) => {
        if (
          lineAnnotations != null &&
          isDiffAnnotationCollection(lineAnnotations)
        ) {
          flushSync(() => {
            setAnnotations(lineAnnotations);
          });
        }
      },
    }),
    []
  );

  // Apply (or clear) the demo markers whenever the normal view enters an edit
  // session or the toggle changes. onAttach supplies the session editor after
  // attachment completes, so retry until the ref receives it.
  useEffect(() => {
    if (!edit || viewMode !== 'normal') {
      return;
    }
    let frame = 0;
    const apply = () => {
      const editor = editorRef.current;
      if (editor == null) {
        frame = requestAnimationFrame(apply);
        return;
      }
      try {
        editor.setMarkers(showMarkers ? PLAYGROUND_MARKERS : []);
      } catch {
        frame = requestAnimationFrame(apply);
      }
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [edit, showMarkers, viewMode]);

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
    if (mode !== DEFAULTS.mode) params.set('edit', mode);
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
    mode,
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

  // Submitting persists the form in place: the annotation keeps its position
  // and gains the typed body, which flips its rendering to a comment thread.
  const handleSubmitComment = useCallback(
    (side: AnnotationSide | undefined, lineNumber: number, body: string) => {
      setAnnotations((prev) =>
        prev.map((ann) =>
          ann.side === side && ann.lineNumber === lineNumber
            ? { ...ann, metadata: { ...ann.metadata, body } }
            : ann
        )
      );
      setSelectedRange(null);
      setCommittedSelectedRange(null);
    },
    []
  );

  // An open form is an annotation that is neither the seeded thread nor a
  // submitted comment; it pauses the gutter utility so forms can't stack.
  const hasOpenCommentForm = annotations.some(
    (ann) => ann.metadata.isThread !== true && ann.metadata.body == null
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

  // Editing is controlled only in Normal view. Virtualizer and CodeView own
  // per-surface controls, so return Normal to Review when switching views.
  const setViewModeAndResetEditor = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (mode !== 'normal') setMode('review');
  }, []);

  const [usePrerenderedHTML, setUsePrerenderedHTML] = useState(
    () => viewMode === 'normal'
  );
  if (usePrerenderedHTML && viewMode !== 'normal') {
    setUsePrerenderedHTML(false);
  }

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
    mode,
    setMode,
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
    CodeViewReactOptions<PlaygroundAnnotationMetadata>
  >(
    () => ({
      ...renderOptions,
      stickyHeaders: true,
      layout: { paddingTop: 0, paddingBottom: 0, gap: 1 },
      unsafeCSS: ITEM_UNSAFE_CSS,
    }),
    [renderOptions]
  );

  const renderAnnotation = useStableCallback(
    (annotation: DiffLineAnnotation<PlaygroundAnnotationMetadata>) => {
      return annotation.metadata.isThread === true ? (
        <ExampleThread
          onDelete={() =>
            handleCancelComment(annotation.side, annotation.lineNumber)
          }
        />
      ) : annotation.metadata.body != null ? (
        <CommentThread
          body={annotation.metadata.body}
          onDelete={() =>
            handleCancelComment(annotation.side, annotation.lineNumber)
          }
        />
      ) : (
        <CommentForm
          side={annotation.side}
          lineNumber={annotation.lineNumber}
          onCancel={handleCancelComment}
          onSubmit={handleSubmitComment}
        />
      );
    }
  );

  const options = useMemo(
    () => ({
      ...prerenderedDiff.options,
      ...renderOptions,
      enableLineSelection: canSelectLines,
      enableGutterUtility: canUseGutterComments,
      onLineSelectionStart: handleLineSelectionChange,
      onLineSelectionChange: handleLineSelectionChange,
      onLineSelectionEnd: handleLineSelectionEnd,
      // A stable reference: an inline arrow here changes identity every
      // render, failing the instance's options equality and forcing a full
      // re-render on every commit.
      onGutterUtilityClick: canUseGutterComments
        ? addCommentAtRange
        : undefined,
    }),
    [
      addCommentAtRange,
      canSelectLines,
      canUseGutterComments,
      handleLineSelectionChange,
      handleLineSelectionEnd,
      prerenderedDiff.options,
      renderOptions,
    ]
  );

  const fileDiff = (
    <FileDiff
      {...prerenderedDiff}
      prerenderedHTML={
        usePrerenderedHTML ? prerenderedDiff.prerenderedHTML : undefined
      }
      className="border-border overflow-hidden rounded-lg border"
      edit={edit}
      editOptions={editOptions}
      selectedLines={selectedRange}
      lineAnnotations={showAnnotations ? annotations : EMPTY_ANNOTATIONS}
      options={options}
      renderAnnotation={showAnnotations ? renderAnnotation : undefined}
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
      {viewMode === 'normal' ? (
        fileDiff
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
