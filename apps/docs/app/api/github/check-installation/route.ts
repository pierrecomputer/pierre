import { NextRequest, NextResponse } from 'next/server';

type HasId = { id: number };

export async function GET(request: NextRequest) {
  const token = request.cookies.get('github_token')?.value;
  const installationId = request.cookies.get('github_installation_id')?.value;

  if (!token || !installationId) {
    return NextResponse.json({ installed: false });
  }

  try {
    const response = await fetch(`https://api.github.com/user/installations`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ installed: false });
    }

    const data = await response.json();
    const hasInstallation = data.installations?.some(
      (inst: HasId) => inst.id.toString() === installationId
    );

    return NextResponse.json({ installed: hasInstallation || false });
  } catch (error) {
    console.error('Error checking installation:', error);
    return NextResponse.json({ installed: false });
  }
}
