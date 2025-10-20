import { CodeStorageGitHubInstallations } from '@pierre/storage-elements-next';
import { type NextRequest } from 'next/server';

const installations = new CodeStorageGitHubInstallations({});

export async function GET(request: NextRequest): Promise<Response> {
  return installations.handleRequest(request);
}
