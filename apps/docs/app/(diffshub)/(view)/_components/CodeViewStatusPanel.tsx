import { IconRefresh } from '@pierre/icons';

import type { ViewerLoadState } from './constants';
import { Button } from '@/components/ui/button';

interface CodeViewStatusPanelProps {
  errorMessage: string | null;
  onRetry(): void;
  state: Exclude<ViewerLoadState, 'ready'>;
}

export function CodeViewStatusPanel({
  errorMessage,
  onRetry,
  state,
}: CodeViewStatusPanelProps) {
  const isError = state === 'error';
  const title = isError
    ? 'Could not load diff'
    : state === 'parsing'
      ? 'Preparing diff'
      : 'Fetching diff';
  const message = isError
    ? (errorMessage ?? 'Failed to fetch the diff.')
    : state === 'parsing'
      ? 'Parsing the patch and building the file tree.'
      : 'Fetching the patch from GitHub.';

  return (
    <div className="col-span-full row-start-2 row-end-3 flex min-h-0 items-center justify-center p-6">
      <section
        role={isError ? 'alert' : 'status'}
        aria-live="polite"
        aria-busy={!isError || undefined}
        className="border-border bg-background/80 w-full max-w-md rounded-xl border p-5 text-center shadow-xs"
      >
        {!isError && (
          <IconRefresh
            aria-hidden="true"
            className="text-muted-foreground mx-auto mb-3 size-5 animate-spin"
          />
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
