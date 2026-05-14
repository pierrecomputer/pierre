import type { DiffIndicators } from '@pierre/diffs';
import {
  IconCodeStyleBars,
  IconDiffSplit,
  IconDiffUnified,
  IconEyeSlash,
  IconFileTreeFill,
  IconGearFill,
  IconSymbolDiffstat,
} from '@pierre/icons';
import Link from 'next/link';
import { type Dispatch, memo, type SetStateAction } from 'react';

import { DiffUrlForm } from '../../_components/DiffUrlForm';
import { DiffsHubLogo } from './DiffsHubLogo';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const SETTING_ROW_CLASS =
  'w-full flex cursor-pointer items-center justify-between gap-4 px-2 py-1.5 text-sm';

interface HeaderProps {
  className?: string;
  diffIndicators: DiffIndicators;
  diffStyle: 'split' | 'unified';
  fileTreeAvailable: boolean;
  fileTreeOverlayOpen: boolean;
  initialUrl: string;
  lineNumbers: boolean;
  overflow: 'wrap' | 'scroll';
  onToggleFileTreeOverlay(): void;
  setDiffIndicators: Dispatch<SetStateAction<DiffIndicators>>;
  setDiffStyle: Dispatch<SetStateAction<'split' | 'unified'>>;
  setLineNumbers: Dispatch<SetStateAction<boolean>>;
  setOverflow: Dispatch<SetStateAction<'wrap' | 'scroll'>>;
  setShowBackgrounds: Dispatch<SetStateAction<boolean>>;
  showBackgrounds: boolean;
}

export const CodeViewHeader = memo(function CodeViewHeader({
  className,
  diffIndicators,
  diffStyle,
  fileTreeAvailable,
  fileTreeOverlayOpen,
  initialUrl,
  lineNumbers,
  overflow,
  onToggleFileTreeOverlay,
  setDiffIndicators,
  setDiffStyle,
  setLineNumbers,
  setOverflow,
  setShowBackgrounds,
  showBackgrounds,
}: HeaderProps) {
  return (
    <div
      className={cn(
        'z-10 contain-layout contain-paint flex flex-wrap md:flex-nowrap items-center gap-2.5 pt-3 pb-2 px-4 md:px-3 md:py-1.5 border-b border-[var(--color-border-opaque)] bg-background md:bg-neutral-50 md:dark:bg-neutral-900',
        className
      )}
    >
      <Link
        href="/"
        className="absolute top-4 left-[50%] inline-flex -translate-x-1/2 transition-transform duration-200 hover:scale-110 md:static md:translate-x-0"
      >
        <DiffsHubLogo />
      </Link>
      <DiffUrlForm
        className="order-last md:order-none md:mr-auto"
        initialUrl={initialUrl}
        placeholder="https://github.com/org/repo/123"
        inputClassName="w-full md:w-auto"
      />
      <div className="flex w-full items-center justify-between gap-2 md:w-auto md:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon-md"
          aria-pressed={fileTreeOverlayOpen}
          disabled={!fileTreeAvailable}
          title={fileTreeOverlayOpen ? 'Hide file tree' : 'Show file tree'}
          className="hover:text-muted-foreground hover:bg-transparent md:hidden"
          onClick={onToggleFileTreeOverlay}
        >
          <IconFileTreeFill className="size-4 md:size-3" />
        </Button>
        <div className="flex items-center gap-1">
          <div className="hidden items-center md:flex">
            <Button
              type="button"
              variant="ghost"
              size="icon-md"
              title={
                diffStyle === 'split'
                  ? 'Switch to unified view'
                  : 'Switch to split view'
              }
              className="hover:text-muted-foreground hover:bg-transparent"
              onClick={() =>
                setDiffStyle(diffStyle === 'split' ? 'unified' : 'split')
              }
            >
              {diffStyle === 'split' ? (
                <IconDiffSplit className="size-4 md:size-3" />
              ) : (
                <IconDiffUnified className="size-4 md:size-3" />
              )}
            </Button>
          </div>
          <div className="bg-border hidden h-3 w-px md:block" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-md"
                className="hover:text-muted-foreground hover:bg-transparent"
              >
                <IconGearFill className="size-4 md:size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                className="cursor-default p-0"
                onSelect={(e) => e.preventDefault()}
              >
                <label className={SETTING_ROW_CLASS}>
                  <span className="min-w-0 flex-1">Backgrounds</span>
                  <Switch
                    checked={showBackgrounds}
                    onCheckedChange={setShowBackgrounds}
                  />
                </label>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-default p-0"
                onSelect={(e) => e.preventDefault()}
              >
                <label className={SETTING_ROW_CLASS}>
                  <span className="min-w-0 flex-1">Line numbers</span>
                  <Switch
                    checked={lineNumbers}
                    onCheckedChange={setLineNumbers}
                  />
                </label>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-default p-0"
                onSelect={(e) => e.preventDefault()}
              >
                <label className={SETTING_ROW_CLASS}>
                  <span className="min-w-0 flex-1">Word wrap</span>
                  <Switch
                    checked={overflow === 'wrap'}
                    onCheckedChange={(checked) =>
                      setOverflow(checked ? 'wrap' : 'scroll')
                    }
                  />
                </label>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="w-full px-2 focus:bg-transparent"
                onSelect={(e) => e.preventDefault()}
              >
                <span>Indicator style</span>
                <ButtonGroup
                  className="ml-auto"
                  value={diffIndicators}
                  onValueChange={(value) =>
                    setDiffIndicators(value as DiffIndicators)
                  }
                >
                  <ButtonGroupItem value="bars" className="size-7 p-0">
                    <IconCodeStyleBars className="size-3" />
                  </ButtonGroupItem>
                  <ButtonGroupItem value="classic" className="size-7 p-0">
                    <IconSymbolDiffstat className="size-3" />
                  </ButtonGroupItem>
                  <ButtonGroupItem value="none" className="size-7 p-0">
                    <IconEyeSlash className="size-3" />
                  </ButtonGroupItem>
                </ButtonGroup>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <hr className="border-border/80 w-full md:hidden" />
    </div>
  );
});
