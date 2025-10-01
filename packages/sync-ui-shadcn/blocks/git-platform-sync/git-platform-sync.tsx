import { Button } from '@/components/ui/button';
import { version as versionCore } from '@pierre/sync-ui-core';
import { version as versionHooks } from '@pierre/sync-ui-hooks';

export function GitPlatformSync() {
  console.log('versionCore', versionCore);
  console.log('versionHooks', versionHooks);
  return <Button variant="outline">GitHub sync</Button>;
}
