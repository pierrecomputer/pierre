'use client';

import { IconArrow, IconRefresh } from '@pierre/icons';
import { useRouter } from 'next/navigation';
import {
  type FormEvent,
  memo,
  useCallback,
  useState,
  useTransition,
} from 'react';

import { getPatchViewerHref } from '../(view)/_components/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DEFAULT_PR_URL = 'https://github.com/nodejs/node/pull/59805';

// Submitting the home form should move to the shareable viewer URL first. The
// viewer route owns fetching and renders its own loading state there.
export const HomeFetchForm = memo(function HomeFetchForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage(null);

      const formData = new FormData(event.currentTarget);
      const urlField = formData.get('url');
      const rawUrl = typeof urlField === 'string' ? urlField.trim() : '';
      const viewerHref = getPatchViewerHref(rawUrl);
      if (viewerHref == null) {
        setErrorMessage('Enter a valid GitHub URL.');
        return;
      }

      startTransition(() => router.push(viewerHref));
    },
    [router]
  );

  return (
    <div className="my-5 space-y-2">
      <form
        onSubmit={handleSubmit}
        className="flex max-w-2xl flex-col gap-2 sm:flex-row"
      >
        <Input
          type="url"
          name="url"
          inputSize="lg"
          placeholder="Enter a GitHub URL"
          defaultValue={DEFAULT_PR_URL}
          required
          disabled={isPending}
          className="text-md bg-background h-11 rounded-lg sm:flex-1"
        />
        <Button
          type="submit"
          variant="default"
          size="icon"
          className="size-11 rounded-lg"
          disabled={isPending}
          aria-label={isPending ? 'Opening…' : 'Fetch'}
        >
          {isPending ? (
            <IconRefresh className="size-4 animate-spin" />
          ) : (
            <IconArrow className="size-4 rotate-180" />
          )}
        </Button>
      </form>
      {errorMessage != null && (
        <p className="text-destructive text-sm" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
});
