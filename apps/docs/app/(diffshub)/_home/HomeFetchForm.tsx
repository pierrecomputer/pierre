'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { setCachedPatchText } from '../(view)/_components/patchCache';
import { getPullRequestPath } from '../(view)/_components/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DEFAULT_PR_URL = 'https://github.com/twbs/bootstrap/pull/42369';

// Submitting the home form runs the patch fetch up front so users see a
// "Fetching..." state on `/` instead of an empty viewer shell on the diff page.
// Once the patch text is in hand we stash it in the in-memory cache and
// navigate; CodeViewHeader reuses the cached text so the diff renders without
// a second round trip.
export function HomeFetchForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const urlField = formData.get('url');
    const rawUrl = typeof urlField === 'string' ? urlField.trim() : '';
    const prPath = getPullRequestPath(rawUrl);
    if (prPath == null) {
      setErrorMessage('Enter a valid GitHub pull request URL.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/fetch-pr-patch?path=${encodeURIComponent(prPath)}`
      );
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(
          detail.length > 0 ? detail : `Request failed (${response.status}).`
        );
      }
      const patchText = await response.text();
      setCachedPatchText(prPath, patchText);
      // `prPath` is shaped like `/owner/repo/pull/<number>` (or with a
      // trailing `.patch`), which is exactly the suffix the path-style
      // viewer route expects. Strip `.patch` because the route's dynamic
      // segment is just the PR number.
      const cleanPrPath = prPath.replace(/\.patch$/, '');
      router.push(cleanPrPath);
    } catch (error) {
      setSubmitting(false);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to fetch the diff.'
      );
    }
  }

  return (
    <div className="space-y-2">
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="flex max-w-2xl flex-col gap-2 sm:flex-row"
      >
        <Input
          type="url"
          name="url"
          inputSize="lg"
          placeholder="Enter a GitHub pull request URL"
          defaultValue={DEFAULT_PR_URL}
          required
          disabled={submitting}
          className="text-md bg-background h-11 rounded-lg sm:flex-1"
        />
        <Button
          type="submit"
          size="lg"
          disabled={submitting}
          className="text-md h-11 rounded-lg"
        >
          {submitting ? 'Fetching…' : 'Fetch'}
        </Button>
      </form>
      {errorMessage != null && (
        <p className="text-destructive text-sm" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
