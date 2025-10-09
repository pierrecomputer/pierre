import type { components } from '@octokit/openapi-types';
import { Octokit } from '@octokit/rest';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('github_token')?.value;

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    // Use the user's OAuth token to fetch all installations they have access to
    const userOctokit = new Octokit({ auth: token });

    // Get all installations the user has access to
    const { data: installationsResponse } = await userOctokit.request(
      'GET /user/installations',
      {
        per_page: 100,
      }
    );

    // Extract owners directly from installations - each installation has exactly one account/owner
    const owners = installationsResponse.installations
      .map((installation) => installation.account)
      .filter(
        (
          account
        ): account is components['schemas']['simple-user'] &
          components['schemas']['enterprise'] => account !== null
      );

    return NextResponse.json({
      data: {
        owners,
      },
    });
  } catch (error) {
    console.error('Error fetching installations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch installations' },
      { status: 500 }
    );
  }
}
