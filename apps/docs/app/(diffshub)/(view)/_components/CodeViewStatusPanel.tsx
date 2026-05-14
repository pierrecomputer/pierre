import { IconCiWarningFill, IconRefresh } from '@pierre/icons';

import type { ViewerLoadState } from './types';
import { Button } from '@/components/ui/button';

interface CodeViewStatusPanelProps {
  errorMessage: string | null;
  onRetry(): void;
  state: ViewerLoadState;
}

export function CodeViewStatusPanel({
  errorMessage,
  onRetry,
  state,
}: CodeViewStatusPanelProps) {
  const isError = state === 'error';
  const title = isError
    ? 'Couldn’t load diff'
    : state === 'parsing'
      ? 'Preparing diff'
      : state === 'fetching'
        ? 'Fetching diff'
        : 'Streaming diff';

  const message = isError
    ? (errorMessage ?? 'Failed to fetch the diff, please try again.')
    : state === 'parsing'
      ? 'Parsing the patch and building the file tree…'
      : state === 'fetching'
        ? 'Fetching the patch from GitHub…'
        : 'Reading the patch and showing files as they arrive…';

  return (
    <div className="col-span-full flex min-h-0 items-center justify-center p-6">
      <section
        role={isError ? 'alert' : 'status'}
        aria-live="polite"
        aria-busy={!isError || undefined}
        className="w-full max-w-md p-5 text-center"
      >
        {!isError ? (
          <IconRefresh
            aria-hidden="true"
            className="text-muted-foreground mx-auto mb-3 size-5 -scale-x-100 animate-spin [animation-direction:reverse]"
          />
        ) : (
          <IconCiWarningFill className="text-muted-foreground mx-auto mb-3 size-5" />
        )}
        <h2 className="text-foreground text-sm font-medium">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{message}</p>
        {isError && (
          <Button type="button" className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        )}
      </section>
    </div>
  );
}
