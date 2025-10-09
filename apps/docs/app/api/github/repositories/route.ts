import { getInstallationClient } from '@pierre/sync-ui-core/github';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('github_token')?.value;
  const installationId = request.cookies.get('github_installation_id')?.value;

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    if (installationId) {
      const octokit = await getInstallationClient(parseInt(installationId));
      const { data } = await octokit.request('GET /installation/repositories', {
        per_page: 100,
      });

      return NextResponse.json({ repositories: data.repositories });
    }

    const response = await fetch('https://api.github.com/user/repos', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch repositories');
    }

    const repositories = await response.json();
    return NextResponse.json({ repositories });
  } catch (error) {
    console.error('Error fetching repositories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch repositories' },
      { status: 500 }
    );
  }
}
