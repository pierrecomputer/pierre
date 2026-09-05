'use client';

import {
  type AnnotationSide,
  type DiffIndicators,
  type DiffLineAnnotation,
  type FileDiffEditCompleteEvent,
  type FileDiffOptions,
  type FileEditCompleteEvent,
  type FileOptions,
  type LineAnnotation,
  setHighlighter as registerHighlighter,
  type SelectedLineRange,
  shikiHighlighter,
} from '@pierre/diffs';
import type {
  Editor,
  EditorOptions,
  EditorType,
  EditPredictProvider,
  EditPredictResponse,
} from '@pierre/diffs/edit';
import {
  type CodeViewReactOptions,
  File,
  FileDiff,
  useStableCallback,
  useWorkerPool,
} from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import {
  IconBrandGithub,
  IconBrush,
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
  IconSparkle,
  IconSymbolDiffstat,
  IconWordWrap,
  IconXSquircle,
} from '@pierre/icons';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { CodestralIcon } from '../_edit/CodestralIcon';
import type { PlaygroundAnnotationMetadata } from './constants';
import {
  CODE_VIEW_ITEMS,
  ITEM_UNSAFE_CSS,
  PLAYGROUND_FILE,
  PLAYGROUND_MARKERS,
  VIRTUALIZER_FILE_DIFFS,
} from './constants';
import { PlaygroundCodeView } from './PlaygroundCodeView';
import {
  CommentForm,
  CommentThread,
  ExampleThread,
} from './PlaygroundComments';
import { EditSessionButtons } from './PlaygroundEditButtons';
import { PlaygroundVirtualizerElementView } from './PlaygroundVirtualizerElementView';
import { PlaygroundVirtualizerView } from './PlaygroundVirtualizerView';
import type {
  HunkSeparatorValue,
  LineHoverHighlight,
  PlaygroundHighlighter,
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
import { ToggleSwitch } from '@/components/ui/toggle-switch';

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
  { value: 'diff', label: 'Diff' },
  { value: 'file', label: 'File' },
  { value: 'virtualizer', label: 'Virtualizer (win)' },
  { value: 'virtualizer-element', label: 'Virtualizer (el)' },
  { value: 'codeview', label: 'CodeView' },
] as const;

const EMPTY_ANNOTATIONS: DiffLineAnnotation<PlaygroundAnnotationMetadata>[] =
  [];
const EMPTY_FILE_ANNOTATIONS: LineAnnotation<PlaygroundAnnotationMetadata>[] =
  [];

type PredictionStatus =
  | 'idle'
  | 'waiting'
  | 'predicting'
  | 'ready'
  | 'empty'
  | 'error';

const PREDICTION_STATUS_TEXT: Record<PredictionStatus, React.ReactNode> = {
  idle: null,
  waiting: 'Codestral ready.',
  predicting: 'Predicting…',
  ready: (
    <>
      Prediction ready — press <kbd>Tab</kbd> to accept or <kbd>Esc</kbd> to
      dismiss.
    </>
  ),
  empty: 'No suggestion returned. Keep editing to try again.',
  error: 'Prediction unavailable. Check the demo service and try again.',
};

function isDirectView(viewMode: ViewMode): boolean {
  return viewMode === 'diff' || viewMode === 'file';
}

// Pure rendering options shared by all three view modes. These keys don't depend
// on the annotation metadata generic, so a single annotation-agnostic type keeps
// them assignable to FileDiff, VirtualizedFileDiff, and CodeView alike (spreading
// a `<undefined>`-typed options object into an annotated FileDiff would otherwise
// widen its annotation callbacks to `undefined`). The Virtualizer views take
// this as their options prop: it carries no callback keys, so it also spreads
// cleanly into the plain-file FileOptions their README component uses.
export type SharedRenderOptions = Pick<
  FileDiffOptions<undefined, undefined>,
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

const HIGHLIGHTER_OPTIONS = [
  { value: 'shiki', label: 'Shiki' },
  { value: 'chamele', label: 'Chamele' },
] as const;

interface PlaygroundClientProps {
  prerenderedDiff: PreloadFileDiffResult<
    PlaygroundAnnotationMetadata,
    undefined
  >;
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
  editPredictionEnabled: boolean;
  setEditPredictionEnabled: (v: boolean) => void;
  editing: boolean;
  showMarkers: boolean;
  setShowMarkers: (v: boolean) => void;
  highlighter: PlaygroundHighlighter;
  setHighlighter: (v: PlaygroundHighlighter) => void;
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
  editPredictionEnabled,
  setEditPredictionEnabled,
  editing,
  showMarkers,
  setShowMarkers,
  highlighter,
  setHighlighter,
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

        <ToggleButton
          icon={<IconSparkle />}
          label="Tab completion"
          checked={editPredictionEnabled}
          onCheckedChange={setEditPredictionEnabled}
        />

        {/* Markers use the direct view's active edit-session editor. */}
        {isDirectView(viewMode) && (
          <ToggleButton
            icon={<IconCiWarning />}
            label="Markers"
            checked={showMarkers}
            onCheckedChange={setShowMarkers}
            // Markers require an attached editor, so they only apply while
            // a session is active.
            disabled={!editing}
            title={!editing ? 'Start editing to show lint markers' : undefined}
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

        <div className="bg-border h-6 w-px" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="justify-start px-3">
              <IconBrush />
              Highlighter:{' '}
              {HIGHLIGHTER_OPTIONS.find((opt) => opt.value === highlighter)
                ?.label ?? highlighter}
              <IconChevronSm className="text-muted-foreground ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            scrollSelectedIntoView
            className={dropdownContentClassName}
          >
            {HIGHLIGHTER_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setHighlighter(option.value)}
                selected={highlighter === option.value}
              >
                {option.label}
                {highlighter === option.value && (
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
  const [edit, setEdit] = useState(urlState.edit);
  const [showMarkers, setShowMarkers] = useState(urlState.showMarkers);
  const [highlighter, setHighlighterChoice] = useState(urlState.highlighter);
  const editPredictionEnabledRef = useRef(urlState.editPrediction);
  const [editPredictionEnabled, setEditPredictionEnabled] = useState(
    urlState.editPrediction
  );
  const codestralEnabledRef = useRef(false);
  const [codestralEnabled, setCodestralEnabled] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [githubAuthenticated, setGithubAuthenticated] = useState(false);
  const [predictionStatus, setPredictionStatus] =
    useState<PredictionStatus>('idle');
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
  const [fileAnnotations, setFileAnnotations] = useState<
    LineAnnotation<PlaygroundAnnotationMetadata>[]
  >([]);

  const interactionMode: 'select' | 'comment' | 'none' = enableGutterUtility
    ? 'comment'
    : enableLineSelection
      ? 'select'
      : 'none';

  const handleEditPredictionEnabledChange = useCallback((enabled: boolean) => {
    editPredictionEnabledRef.current = enabled;
    setEditPredictionEnabled(enabled);
    setPredictionStatus(
      enabled && codestralEnabledRef.current ? 'waiting' : 'idle'
    );
  }, []);

  const redirectToGithubAuth = useCallback(() => {
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set('predict', '1');
    const returnTo = `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
    window.location.assign(
      `/edit/auth?returnTo=${encodeURIComponent(returnTo)}`
    );
  }, []);

  const predictionProvider = useMemo<EditPredictProvider>(
    () => ({
      async predict(request, { signal }) {
        if (!editPredictionEnabledRef.current || !codestralEnabledRef.current) {
          const prefix = request.excerptText.slice(
            0,
            request.cursorOffsetInExcerpt
          );
          const lines = prefix.split(request.eol);
          return {
            edits: [],
            newCursor: {
              line: request.excerptStartLine + lines.length - 1,
              character: lines.at(-1)?.length ?? 0,
            },
          };
        }

        setPredictionStatus('predicting');
        try {
          const response = await fetch('/edit/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal,
          });
          if (response.status === 401) {
            setGithubAuthenticated(false);
            redirectToGithubAuth();
            throw new Error('GitHub sign-in required');
          }
          if (!response.ok) {
            throw new Error('Edit prediction request failed');
          }
          const prediction = (await response.json()) as EditPredictResponse;
          if (!signal.aborted) {
            setPredictionStatus(
              prediction.edits.length === 0 ? 'empty' : 'ready'
            );
          }
          return prediction;
        } catch (error) {
          if (!signal.aborted) {
            setPredictionStatus('error');
          }
          throw error;
        }
      },
    }),
    [redirectToGithubAuth]
  );

  const editPrediction = useMemo(
    () => ({ mode: 'eager' as const, provider: predictionProvider }),
    [predictionProvider]
  );

  useEffect(() => {
    const controller = new AbortController();

    void fetch('/edit/auth', {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) {
          setGithubAuthenticated(response.status === 204);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setGithubAuthenticated(false);
        }
      });

    return () => controller.abort();
  }, []);

  const tryCodestral = useCallback(async () => {
    setAuthenticating(true);
    try {
      const response = await fetch('/edit/auth', {
        method: 'HEAD',
        cache: 'no-store',
      });
      if (response.status === 401) {
        setGithubAuthenticated(false);
        redirectToGithubAuth();
        return;
      }
      if (!response.ok) {
        setPredictionStatus('error');
        return;
      }
      setGithubAuthenticated(true);
      codestralEnabledRef.current = true;
      setCodestralEnabled(true);
      setPredictionStatus('waiting');
    } catch {
      setPredictionStatus('error');
    } finally {
      setAuthenticating(false);
    }
  }, [redirectToGithubAuth]);

  const predictionStatusText = authenticating
    ? 'Checking GitHub sign-in…'
    : PREDICTION_STATUS_TEXT[predictionStatus];

  const editorRef = useRef<Editor<
    EditorType,
    PlaygroundAnnotationMetadata
  > | null>(null);
  const editorOptions = useMemo<
    EditorOptions<EditorType, PlaygroundAnnotationMetadata, undefined>
  >(
    () => ({
      editPrediction,
      onAttach(editor) {
        editorRef.current = editor;
        editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      },
    }),
    [editPrediction]
  );

  // The file/diff the direct views show: the fixtures until a session is
  // saved, then the accepted values. Save accepts the completed value under a
  // fresh cacheKey; Cancel marks the session before turning edit off so the
  // completion handler reverts instead.
  const [playgroundFile, setPlaygroundFile] = useState(PLAYGROUND_FILE);
  const [playgroundDiff, setPlaygroundDiff] = useState(
    prerenderedDiff.fileDiff
  );
  const cancelledEdit = useRef(false);
  const savedVersionRef = useRef(0);
  const handleFileEditComplete = useCallback(
    (event: FileEditCompleteEvent<PlaygroundAnnotationMetadata, undefined>) => {
      if (cancelledEdit.current) {
        cancelledEdit.current = false;
        return 'reject';
      }
      savedVersionRef.current += 1;
      event.file.cacheKey = `${event.file.name}:v${savedVersionRef.current}`;
      setPlaygroundFile(event.file);
      // Adopt the session's final annotation positions so the comment
      // portals render into the accepted (moved) slots.
      if (event.lineAnnotations != null) {
        setFileAnnotations(event.lineAnnotations);
      }
      return 'accept';
    },
    []
  );
  const handleDiffEditComplete = useCallback(
    (
      event: FileDiffEditCompleteEvent<PlaygroundAnnotationMetadata, undefined>
    ) => {
      if (cancelledEdit.current) {
        cancelledEdit.current = false;
        return 'reject';
      }
      savedVersionRef.current += 1;
      event.fileDiff.cacheKey = `${event.fileDiff.name}:v${savedVersionRef.current}`;
      setPlaygroundDiff(event.fileDiff);
      if (event.lineAnnotations != null) {
        setAnnotations(event.lineAnnotations);
      }
      return 'accept';
    },
    []
  );
  // Not a stable callback: the components call renderHeaderMetadata during
  // render, so it has to close over the current `edit` each time.
  const renderEditButtons = useCallback(
    () => (
      <EditSessionButtons
        editing={edit}
        onEdit={() => {
          cancelledEdit.current = false;
          setEdit(true);
        }}
        onCancel={() => {
          cancelledEdit.current = true;
          setEdit(false);
        }}
        onSave={() => {
          cancelledEdit.current = false;
          setEdit(false);
        }}
      />
    ),
    [edit]
  );

  // Apply (or clear) the demo markers whenever a direct view enters an edit
  // session or the toggle changes. onAttach supplies the session editor after
  // attachment completes, so retry until the ref receives it.
  useEffect(() => {
    if (!edit || !isDirectView(viewMode)) {
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
    if (editPredictionEnabled !== DEFAULTS.editPrediction)
      params.set('predict', editPredictionEnabled ? '1' : '0');
    if (edit && isDirectView(viewMode)) params.set('edit', 'edit');
    if (highlighter !== DEFAULTS.highlighter) params.set('hl', highlighter);
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
    editPredictionEnabled,
    edit,
    showMarkers,
    highlighter,
    committedSelectedRange,
  ]);

  // The querystring only exists so the current setup can be shared as a
  // link; the server reads it on a real navigation. Sync it with the native
  // History API — a router navigation would refetch the page's server
  // payload on every toggle for no benefit.
  useEffect(() => {
    window.history.replaceState(null, '', buildUrl());
  }, [buildUrl]);

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

  const addFileCommentAtRange = useCallback((range: SelectedLineRange) => {
    const lineNumber = range.end;
    setFileAnnotations((current) =>
      current.some((annotation) => annotation.lineNumber === lineNumber)
        ? current
        : [
            ...current,
            {
              lineNumber,
              metadata: { key: `line-${lineNumber}`, isThread: false },
            },
          ]
    );
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

  const handleCancelFileComment = useCallback(
    (_side: AnnotationSide | undefined, lineNumber: number) => {
      setFileAnnotations((current) =>
        current.filter((annotation) => annotation.lineNumber !== lineNumber)
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

  const handleSubmitFileComment = useCallback(
    (_side: AnnotationSide | undefined, lineNumber: number, body: string) => {
      setFileAnnotations((current) =>
        current.map((annotation) =>
          annotation.lineNumber === lineNumber
            ? { ...annotation, metadata: { ...annotation.metadata, body } }
            : annotation
        )
      );
      setSelectedRange(null);
      setCommittedSelectedRange(null);
    },
    []
  );

  // An open form is an annotation that is neither the seeded thread nor a
  // submitted comment; it pauses the gutter utility so forms can't stack.
  const hasOpenCommentForm = (
    viewMode === 'file' ? fileAnnotations : annotations
  ).some(
    (annotation) =>
      annotation.metadata.isThread !== true && annotation.metadata.body == null
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

  // Switching views ends any direct-view edit session; the scrolling views
  // own per-component controls instead.
  const setViewModeAndResetEditor = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setEdit(false);
  }, []);

  // Swap the library's registered highlighter to match the picker. The
  // chamele implementation (wasm lexers + Zed themes) is imported lazily so
  // the default shiki path never pays for it. `activeHighlighter` flips after
  // the swap lands: the resulting commit re-renders the direct File/FileDiff
  // surfaces IN PLACE (their render pass notices the pending registration
  // change), keeping scroll position so the two color palettes can be
  // compared side by side; the imperative list views remount via `key`.
  const [activeHighlighter, setActiveHighlighter] =
    useState<PlaygroundHighlighter>('shiki');
  useEffect(() => {
    let cancelled = false;
    const implementation =
      highlighter === 'chamele'
        ? import('@pierre/diffs/chamele').then((m) => m.chameleHighlighter)
        : Promise.resolve(shikiHighlighter);
    void implementation.then((impl) => {
      if (cancelled) return;
      registerHighlighter(impl);
      setActiveHighlighter(highlighter);
    });
    return () => {
      cancelled = true;
    };
  }, [highlighter]);

  // The registry is process-wide: leaving the playground must not leave the
  // rest of the docs app on the picker's choice.
  useEffect(() => {
    return () => {
      registerHighlighter(shikiHighlighter);
    };
  }, []);

  // The prerendered payload was highlighted by shiki on the server, so it is
  // only hydrated while shiki is the picked highlighter; picking chamele
  // renders from scratch instead of adopting shiki markup.
  const [usePrerenderedHTML, setUsePrerenderedHTML] = useState(
    () => viewMode === 'diff' && urlState.highlighter === 'shiki'
  );
  if (usePrerenderedHTML && (viewMode !== 'diff' || highlighter !== 'shiki')) {
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
    editPredictionEnabled,
    setEditPredictionEnabled: handleEditPredictionEnabledChange,
    editing: edit,
    showMarkers,
    setShowMarkers,
    highlighter,
    setHighlighter: setHighlighterChoice,
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

  // Pure rendering options shared by every view mode. Interaction and
  // edit-specific options are layered on per component below.
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
  // rendering options; its scrollbar styling mirrors the direct views.
  const codeViewOptions = useMemo<
    CodeViewReactOptions<PlaygroundAnnotationMetadata, undefined>
  >(
    () => ({
      ...renderOptions,
      stickyHeaders: true,
      layout: { paddingTop: 0, paddingBottom: 0, gap: 1 },
      unsafeCSS: ITEM_UNSAFE_CSS,
    }),
    [renderOptions]
  );

  const renderDiffAnnotation = useStableCallback(
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

  const renderFileAnnotation = useStableCallback(
    (annotation: LineAnnotation<PlaygroundAnnotationMetadata>) => {
      return annotation.metadata.body != null ? (
        <CommentThread
          body={annotation.metadata.body}
          onDelete={() =>
            handleCancelFileComment(undefined, annotation.lineNumber)
          }
        />
      ) : (
        <CommentForm
          side={undefined}
          lineNumber={annotation.lineNumber}
          onCancel={handleCancelFileComment}
          onSubmit={handleSubmitFileComment}
        />
      );
    }
  );

  const fileDiffOptions = useMemo(
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

  const fileOptions = useMemo<
    FileOptions<PlaygroundAnnotationMetadata, undefined>
  >(
    () => ({
      ...renderOptions,
      unsafeCSS: ITEM_UNSAFE_CSS,
      enableLineSelection: canSelectLines,
      enableGutterUtility: canUseGutterComments,
      onLineSelectionStart: handleLineSelectionChange,
      onLineSelectionChange: handleLineSelectionChange,
      onLineSelectionEnd: handleLineSelectionEnd,
      onGutterUtilityClick: canUseGutterComments
        ? addFileCommentAtRange
        : undefined,
    }),
    [
      addFileCommentAtRange,
      canSelectLines,
      canUseGutterComments,
      handleLineSelectionChange,
      handleLineSelectionEnd,
      renderOptions,
    ]
  );

  const fileDiff = (
    <FileDiff
      {...prerenderedDiff}
      fileDiff={playgroundDiff}
      prerenderedHTML={
        usePrerenderedHTML ? prerenderedDiff.prerenderedHTML : undefined
      }
      className="border-border overflow-hidden rounded-lg border"
      edit={edit}
      editorOptions={editorOptions}
      onEditComplete={handleDiffEditComplete}
      renderHeaderMetadata={renderEditButtons}
      selectedLines={selectedRange}
      lineAnnotations={showAnnotations ? annotations : EMPTY_ANNOTATIONS}
      options={fileDiffOptions}
      renderAnnotation={showAnnotations ? renderDiffAnnotation : undefined}
    />
  );

  const file = (
    <File
      file={playgroundFile}
      className="border-border overflow-hidden rounded-lg border"
      edit={edit}
      editorOptions={editorOptions}
      onEditComplete={handleFileEditComplete}
      renderHeaderMetadata={renderEditButtons}
      selectedLines={selectedRange}
      lineAnnotations={
        showAnnotations ? fileAnnotations : EMPTY_FILE_ANNOTATIONS
      }
      options={fileOptions}
      renderAnnotation={showAnnotations ? renderFileAnnotation : undefined}
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
      {editPredictionEnabled && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground text-xs">
            Connect Codestral, then edit a file and pause after typing to
            preview a prediction. Press <kbd>Tab</kbd> to accept or{' '}
            <kbd>Esc</kbd> to dismiss.
          </p>
          <div className="flex basis-full items-center justify-start gap-3 md:ml-auto md:basis-auto md:justify-end">
            {(authenticating || predictionStatus !== 'idle') && (
              <span
                className="text-muted-foreground text-xs"
                role="status"
                aria-live="polite"
              >
                {predictionStatusText}
              </span>
            )}
            {!codestralEnabled && (
              <Button
                variant="outline"
                onClick={() => void tryCodestral()}
                disabled={authenticating}
              >
                {githubAuthenticated ? <CodestralIcon /> : <IconBrandGithub />}
                {githubAuthenticated
                  ? 'Continue with Codestral'
                  : 'Connect GitHub'}
              </Button>
            )}
          </div>
        </div>
      )}
      {viewMode === 'diff' ? (
        fileDiff
      ) : viewMode === 'file' ? (
        file
      ) : viewMode === 'virtualizer' ? (
        <PlaygroundVirtualizerView
          key={activeHighlighter}
          diffs={VIRTUALIZER_FILE_DIFFS}
          options={renderOptions}
          enableLineSelection={enableLineSelection}
          enableGutterComments={enableGutterUtility}
          showAnnotations={showAnnotations}
          editPrediction={editPrediction}
        />
      ) : viewMode === 'virtualizer-element' ? (
        <PlaygroundVirtualizerElementView
          key={activeHighlighter}
          diffs={VIRTUALIZER_FILE_DIFFS}
          options={renderOptions}
          enableLineSelection={enableLineSelection}
          enableGutterComments={enableGutterUtility}
          showAnnotations={showAnnotations}
          editPrediction={editPrediction}
        />
      ) : (
        <PlaygroundCodeView
          key={activeHighlighter}
          items={CODE_VIEW_ITEMS}
          options={codeViewOptions}
          enableLineSelection={enableLineSelection}
          enableGutterComments={enableGutterUtility}
          showAnnotations={showAnnotations}
          editPrediction={editPrediction}
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
    <ToggleSwitch
      icon={icon}
      label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      title={title}
    />
  );
}
