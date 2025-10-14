import { CodeStorageGitHubInstallations } from '@pierre/storage-elements-next';
import { type NextRequest } from 'next/server';

const installations = new CodeStorageGitHubInstallations({});

export async function GET(request: NextRequest) {
  return installations.handleRequest(request);
}
