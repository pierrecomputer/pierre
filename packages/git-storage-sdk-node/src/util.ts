export function timingSafeEqual(
  a: string | Uint8Array,
  b: string | Uint8Array
): boolean {
  const bufferA = typeof a === 'string' ? new TextEncoder().encode(a) : a;
  const bufferB = typeof b === 'string' ? new TextEncoder().encode(b) : b;

  if (bufferA.length !== bufferB.length) return false;

  let result = 0;
  for (let i = 0; i < bufferA.length; i++) {
    result |= bufferA[i] ^ bufferB[i];
  }
  return result === 0;
}

export async function getEnvironmentCrypto() {
  if (!globalThis.crypto) {
    const { webcrypto } = await import('node:crypto');
    return webcrypto;
  }
  return globalThis.crypto;
}

export async function createHmac(
  algorithm: string,
  secret: string,
  data: string
): Promise<string> {
  if (algorithm !== 'sha256') {
    throw new Error('Only sha256 algorithm is supported');
  }
  if (!secret || secret.length === 0) {
    throw new Error('Secret is required');
  }

  const crypto = await getEnvironmentCrypto();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
