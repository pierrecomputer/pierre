import { IconCiWarningFill, IconRefresh } from '@pierre/icons';

import { useChromeThemeProps } from './useChromeThemeProps';
import { Button } from '@/components/Button';
import { cn } from '@/lib/cn';
import { diffshubChromeMapping } from '@/lib/theme/diffshubChromeMapping';
import type { ViewerLoadState } from '@/lib/types';

interface DiffsHubStatusPanelProps {
  errorMessage: string | null;
  onRetry(): void;
  state: ViewerLoadState;
}

export function DiffsHubStatusPanel({
  errorMessage,
  onRetry,
  state,
}: DiffsHubStatusPanelProps) {
  // Mirror the rest of the diffshub chrome so the loading screen sits on the
  // active Shiki theme's surface instead of the global light/dark palette.
  // Mounted before the viewer is available, so we lean on the same provider
  // useChromeThemeProps the header/sidebar use — the controller source keeps the
  // last-resolved theme, so this stays on-palette without flashing the default.
  const { style: chromeStyle } = useChromeThemeProps(diffshubChromeMapping);
  const themeChromeStyle =
    Object.keys(chromeStyle).length > 0 ? chromeStyle : undefined;
  const isError = state === 'error';
  const isEmpty = state === 'empty';
  const isLoading = !isError && !isEmpty;
  const title = isError
    ? 'Couldn’t load diff'
    : isEmpty
      ? 'No changes'
      : state === 'parsing'
        ? 'Preparing diff'
        : state === 'fetching'
          ? 'Fetching diff'
          : 'Streaming diff';

  const message = isError
    ? (errorMessage ?? 'Failed to fetch the diff, please try again.')
    : isEmpty
      ? 'There are no file changes in this diff.'
      : state === 'parsing'
        ? 'Parsing the patch and building the file tree…'
        : state === 'fetching'
          ? 'Fetching the patch from GitHub…'
          : 'Reading the patch and showing files as they arrive…';

  return (
    <div
      className={cn(
        'diffshub-theme-bootstrap col-span-full flex min-h-0 min-w-0 justify-center overflow-y-auto p-6',
        themeChromeStyle == null && 'bg-background'
      )}
      style={themeChromeStyle}
    >
      <section
        role={isError ? 'alert' : 'status'}
        aria-live="polite"
        aria-busy={isLoading || undefined}
        className="my-auto w-full max-w-md min-w-0 p-5 text-center"
      >
        {isLoading ? (
          <IconRefresh
            aria-hidden="true"
            className="text-muted-foreground mx-auto mb-3 size-5 -scale-x-100 animate-spin [animation-direction:reverse]"
          />
        ) : isError ? (
          <IconCiWarningFill className="text-muted-foreground mx-auto mb-3 size-5" />
        ) : null}
        <h2 className="text-foreground text-sm font-medium">{title}</h2>
        <p
          className={cn(
            'text-muted-foreground mt-1 text-sm wrap-anywhere text-pretty',
            isError && 'line-clamp-4'
          )}
        >
          {message}
        </p>
        {isError && (
          <Button type="button" className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        )}
      </section>
    </div>
  );
}
