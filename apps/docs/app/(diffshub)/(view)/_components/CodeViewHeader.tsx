import type { DiffIndicators } from '@pierre/diffs';
import { useStableCallback } from '@pierre/diffs/react';
import {
  IconArrow,
  IconCodeStyleBars,
  IconDiffSplit,
  IconDiffUnified,
  IconEyeSlash,
  IconFileTreeFill,
  IconGearFill,
  IconRefresh,
  IconSymbolDiffstat,
} from '@pierre/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type Dispatch,
  type FormEvent,
  memo,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useState,
  useTransition,
} from 'react';

import { DiffsHubLogo } from './DiffsHubLogo';
import { getGitHubPath } from './utils';
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

/** Full-row hit target: native label activates the nested switch when the caption is clicked. */
const VIEW_OPTION_LABEL_CLASS =
  'w-full flex cursor-pointer items-center justify-between gap-4 px-2 py-1.5 text-sm';

interface HeaderProps {
  className?: string;
  diffStyle: 'split' | 'unified';
  fileTreeAvailable: boolean;
  fileTreeOverlayOpen: boolean;
  initialUrl: string;
  loading: boolean;
  onToggleFileTreeOverlay(): void;
  setDiffStyle: Dispatch<SetStateAction<'split' | 'unified'>>;
  overflow: 'wrap' | 'scroll';
  setOverflow: Dispatch<SetStateAction<'wrap' | 'scroll'>>;
  showBackgrounds: boolean;
  setShowBackgrounds: Dispatch<SetStateAction<boolean>>;
  diffIndicators: DiffIndicators;
  setDiffIndicators: Dispatch<SetStateAction<DiffIndicators>>;
  lineNumbers: boolean;
  setLineNumbers: Dispatch<SetStateAction<boolean>>;
}

export const CodeViewHeader = memo(function CodeViewHeader({
  className,
  diffStyle,
  fileTreeAvailable,
  fileTreeOverlayOpen,
  initialUrl,
  loading,
  onToggleFileTreeOverlay,
  overflow,
  setOverflow,
  showBackgrounds,
  setShowBackgrounds,
  diffIndicators,
  setDiffIndicators,
  lineNumbers,
  setLineNumbers,
  setDiffStyle,
}: HeaderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [url, setURL] = useState(initialUrl);
  const busy = isPending || loading;
  /** Radix `align` is not CSS-breakpoint aware; mirror Tailwind `md` (768px). */
  const [viewOptionsMenuAlign, setViewOptionsMenuAlign] = useState<
    'start' | 'end'
  >('start');
  useLayoutEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const sync = () => setViewOptionsMenuAlign(media.matches ? 'end' : 'start');
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);

  useEffect(() => {
    setURL(initialUrl);
  }, [initialUrl]);

  const handleSubmit = useStableCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedURL = url.trim();
      const githubPath = getGitHubPath(normalizedURL);
      if (githubPath == null) {
        console.error('Invalid URL', normalizedURL);
        return;
      }

      setURL(normalizedURL);
      startTransition(() => {
        router.push(githubPath);
      });
    }
  );

  return (
    <div
      className={cn(
        'z-10 m-2 mb-0 contain-layout contain-paint flex flex-wrap md:flex-nowrap border-border bg-background items-center gap-2.5 rounded-xl border p-3 md:py-2 shadow-xs',
        className
      )}
    >
      <Link
        href="/"
        className="absolute top-3 left-[50%] inline-flex -translate-x-1/2 transition-transform duration-200 hover:scale-110 md:static md:translate-x-0"
      >
        <DiffsHubLogo />
      </Link>
      <span className="text-md hidden text-neutral-300 md:-mr-2 md:inline-flex">
        /
      </span>
      <form
        className="order-last flex w-full flex-col gap-2 md:order-none md:flex-row md:gap-2"
        onSubmit={handleSubmit}
      >
        <input
          className="text-md focus:bg-accent block h-8 w-full min-w-[220px] rounded-md px-2 text-center focus-visible:outline-none md:h-9 md:text-left"
          value={url}
          onChange={({ currentTarget }) => setURL(currentTarget.value)}
          placeholder="e.g. https://github.com/nodejs/node/pull/59805"
        />
        <Button
          type="submit"
          variant="default"
          size="icon"
          className="hidden md:flex"
          aria-busy={busy || undefined}
          aria-label={busy ? 'Loading diff' : 'Submit'}
        >
          {busy ? (
            <IconRefresh className="size-4 animate-spin" />
          ) : (
            <IconArrow className="size-4 rotate-180" />
          )}
        </Button>
      </form>
      <div className="bg-border mx-1 hidden h-5 w-px md:block" />
      <div className="flex w-full items-center gap-2 md:w-auto">
        <Button
          type="button"
          variant="muted"
          size="icon"
          aria-pressed={fileTreeOverlayOpen}
          disabled={!fileTreeAvailable}
          title={fileTreeOverlayOpen ? 'Hide file tree' : 'Show file tree'}
          className="border-border/80 shrink-0 rounded-lg md:hidden"
          onClick={onToggleFileTreeOverlay}
        >
          <IconFileTreeFill className="size-4" />
        </Button>
        <ButtonGroup
          className="ml-auto hidden md:flex"
          value={diffStyle}
          onValueChange={(value) => setDiffStyle(value as 'split' | 'unified')}
        >
          <ButtonGroupItem value="split" className="size-9 p-0">
            <IconDiffSplit className="size-4" />
            <span className="sr-only">Split view</span>
          </ButtonGroupItem>
          <ButtonGroupItem value="unified" className="size-9 p-0">
            <IconDiffUnified className="size-4" />
            <span className="sr-only">Unified view</span>
          </ButtonGroupItem>
        </ButtonGroup>
        <DropdownMenu open={viewOptionsOpen} onOpenChange={setViewOptionsOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant={viewOptionsOpen ? 'outline' : 'muted'}
              size="icon"
              title="View options"
              className="rounded-lg"
            >
              <IconGearFill className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={viewOptionsMenuAlign} className="w-56">
            <DropdownMenuItem
              className="cursor-default p-0"
              onSelect={(event) => event.preventDefault()}
            >
              <label className={VIEW_OPTION_LABEL_CLASS}>
                <span className="min-w-0 flex-1">Backgrounds</span>
                <Switch
                  checked={showBackgrounds}
                  onCheckedChange={setShowBackgrounds}
                />
              </label>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-default p-0"
              onSelect={(event) => event.preventDefault()}
            >
              <label className={VIEW_OPTION_LABEL_CLASS}>
                <span className="min-w-0 flex-1">Line numbers</span>
                <Switch
                  checked={lineNumbers}
                  onCheckedChange={setLineNumbers}
                />
              </label>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-default p-0"
              onSelect={(event) => event.preventDefault()}
            >
              <label className={VIEW_OPTION_LABEL_CLASS}>
                <span className="min-w-0 flex-1">Word wrap</span>
                <Switch
                  checked={overflow === 'wrap'}
                  onCheckedChange={(checked) =>
                    setOverflow(checked ? 'wrap' : 'scroll')
                  }
                  className="shrink-0"
                />
              </label>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="w-full px-2 focus:bg-transparent md:hidden"
              onSelect={(event) => event.preventDefault()}
            >
              <span>Diff layout</span>
              <ButtonGroup
                className="ml-auto"
                value={diffStyle}
                onValueChange={(value) =>
                  setDiffStyle(value as 'split' | 'unified')
                }
              >
                <ButtonGroupItem value="split" className="size-7 p-0">
                  <IconDiffSplit className="size-4" />
                  <span className="sr-only">Split view</span>
                </ButtonGroupItem>
                <ButtonGroupItem value="unified" className="size-7 p-0">
                  <IconDiffUnified className="size-4" />
                  <span className="sr-only">Unified view</span>
                </ButtonGroupItem>
              </ButtonGroup>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="w-full px-2 focus:bg-transparent"
              onSelect={(event) => event.preventDefault()}
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
                  <IconCodeStyleBars size="12" />
                </ButtonGroupItem>
                <ButtonGroupItem value="classic" className="size-7 p-0">
                  <IconSymbolDiffstat size="12" />
                </ButtonGroupItem>
                <ButtonGroupItem value="none" className="size-7 p-0">
                  <IconEyeSlash size="12" />
                </ButtonGroupItem>
              </ButtonGroup>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <hr className="border-border/80 w-full md:hidden" />
    </div>
  );
});
