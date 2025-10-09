import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('github_token')?.value;

  if (!token) {
    return NextResponse.json({ installations: [] });
  }

  try {
    const response = await fetch(`https://api.github.com/user/installations`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ installations: [] });
    }

    const data = await response.json();

    return NextResponse.json({ installations: data.installations || [] });
  } catch (error) {
    console.error('Error fetching installations:', error);
    return NextResponse.json({ installations: [] });
  }
}
