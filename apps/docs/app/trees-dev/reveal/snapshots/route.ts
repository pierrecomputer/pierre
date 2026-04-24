import { NextResponse } from 'next/server';

import {
  REVEAL_DEMO_BATCH_FAILURE_PATH,
  REVEAL_DEMO_SNAPSHOTS,
} from '../../_lib/revealLoadingDemoData';

function getSnapshot(path: string) {
  return (
    REVEAL_DEMO_SNAPSHOTS[path as keyof typeof REVEAL_DEMO_SNAPSHOTS] ?? null
  );
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  if (path == null || path.length === 0) {
    return NextResponse.json({ error: 'Missing path.' }, { status: 400 });
  }

  const snapshot = getSnapshot(path);
  if (snapshot == null) {
    return NextResponse.json(
      { error: `Unknown reveal demo path: ${path}` },
      { status: 404 }
    );
  }

  return NextResponse.json(snapshot);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Expected a JSON body with paths: string[]' },
      { status: 400 }
    );
  }

  if (
    body == null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !('paths' in body) ||
    !Array.isArray(body.paths) ||
    body.paths.some((path) => typeof path !== 'string')
  ) {
    return NextResponse.json(
      { error: 'Expected a JSON body with paths: string[]' },
      { status: 400 }
    );
  }

  const results = body.paths.map((path) => {
    if (path === REVEAL_DEMO_BATCH_FAILURE_PATH) {
      return {
        errorMessage:
          'Background prefetch intentionally fails once here. Expand the folder to trigger the explicit foreground retry.',
      };
    }

    const snapshot = getSnapshot(path);
    return snapshot == null
      ? { errorMessage: `Unknown reveal demo path: ${path}` }
      : { snapshot };
  });

  return NextResponse.json(results);
}
