'use client';

import { IconArrow } from '@pierre/icons';
import { memo } from 'react';

import { Button } from '@/components/Button';
import { DiffUrlForm } from '@/components/DiffUrlForm';

// Submitting the home form should move to the shareable viewer URL first. The
// viewer route owns fetching and renders its own loading state there.
export const HomeFetchForm = memo(function HomeFetchForm() {
  return (
    <div className="bg-accent md:bg-background rounded-lg border px-4 md:my-6">
      <DiffUrlForm
        placeholder="https://github.com/org/repo/123"
        inputClassName="text-md h-12 w-full text-start"
      >
        {(isPending, url) => (
          <Button
            type="submit"
            variant="ghost"
            size="icon-md"
            disabled={isPending || url.length === 0}
            aria-label={isPending ? 'Fetching…' : 'Fetch'}
            className="hover:text-muted-foreground -mr-2 hover:bg-transparent"
          >
            <IconArrow className="size-4 rotate-180" />
          </Button>
        )}
      </DiffUrlForm>
    </div>
  );
});
