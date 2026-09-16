import { describe, expect, test } from 'bun:test';

import { DELETE, GET, POST } from '../app/api/github-comments/route';

describe('GitHub comments route security', () => {
  test('does not load comments without GitHub authorization', async () => {
    const response = await GET(
      new Request(
        'https://diffshub.com/api/github-comments?path=/owner/repo/pull/1'
      )
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('rejects cross-origin posts before reading credentials or JSON', async () => {
    const response = await POST(
      new Request('https://diffshub.com/api/github-comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://attacker.example',
        },
        body: '{not json',
      })
    );

    expect(response.status).toBe(403);
  });

  test('requires an OAuth session for same-origin posts', async () => {
    const response = await POST(
      new Request('https://diffshub.com/api/github-comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://diffshub.com',
        },
        body: '{}',
      })
    );

    expect(response.status).toBe(401);
  });

  test('rejects cross-origin deletes before reading credentials', async () => {
    const response = await DELETE(
      new Request(
        'https://diffshub.com/api/github-comments?path=/owner/repo/pull/1&id=1',
        {
          method: 'DELETE',
          headers: { Origin: 'https://attacker.example' },
        }
      )
    );

    expect(response.status).toBe(403);
  });
});
