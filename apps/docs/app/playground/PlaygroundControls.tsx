'use client';

import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs';
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
  IconHunkDivider,
  IconLink,
  IconListOrdered,
  IconParagraph,
  IconSymbolDiffstat,
  IconWordWrap,
  IconXSquircle,
} from '@pierre/icons';

import type { HunkSeparatorValue } from './playgroundOptions';
import {
  DARK_THEMES,
  HUNK_SEPARATOR_OPTIONS,
  LIGHT_THEMES,
  LINE_DIFF_OPTIONS,
} from './playgroundOptions';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

export interface PlaygroundControlsContentProps {
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
  addCommentAtLine: (side: AnnotationSide, lineNumber: number) => void;
  hideShare?: boolean;
}

export function PlaygroundControlsContent({
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
  hideShare = false,
}: PlaygroundControlsContentProps) {
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

        <div className="bg-border h-6 w-px" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="justify-start">
              <IconHunkDivider />
              {HUNK_SEPARATOR_OPTIONS.find(
                (opt) => opt.value === hunkSeparators
              )?.label ?? hunkSeparators}
              <IconChevronSm className="text-muted-foreground ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {HUNK_SEPARATOR_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setHunkSeparators(option.value)}
                className={
                  hunkSeparators === option.value ? 'bg-accent' : undefined
                }
              >
                {option.label}
                {hunkSeparators === option.value && (
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
          aria-label="Clear selection"
        >
          <IconXSquircle className="text-muted-foreground" />
          Clear
        </Button>

        <div className="bg-border h-6 w-px" />

        <Button
          variant="outline"
          size="sm"
          onClick={() => addCommentAtLine('additions', 9)}
        >
          Add comment at line 9
        </Button>
      </div>
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
