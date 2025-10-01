import { GitPlatformSync } from '@/registry/new-york/blocks/git-platform-sync/git-platform-sync';

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <GitPlatformSync />
    </div>
  );
}
