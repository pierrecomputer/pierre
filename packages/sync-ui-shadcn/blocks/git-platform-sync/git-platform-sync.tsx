import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { version as versionCore } from '@pierre/sync-ui-core';
import { version as versionHooks } from '@pierre/sync-ui-hooks';

export function GitPlatformSync() {
  console.log('versionCore', versionCore);
  console.log('versionHooks', versionHooks);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Sync to GitHub</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Connect to GitHub</h4>
            <p className="text-sm text-muted-foreground">
              Sync your changes to GitHub to backup your code at every snapshot
              by installing our app on your personal account or organization.
            </p>
          </div>
          <div className="space-y-2">
            <Button className="w-full">Install GitHub App</Button>
            <Button variant="secondary" className="w-full">
              Help me get started
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
