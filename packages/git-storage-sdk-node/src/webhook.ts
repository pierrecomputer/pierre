/**
 * Webhook validation utilities for Pierre Git Storage
 */
import type {
  ParsedWebhookSignature,
  RawWebhookPushEvent,
  WebhookEventPayload,
  WebhookPushEvent,
  WebhookValidationOptions,
  WebhookValidationResult,
} from './types';
import { createHmac, timingSafeEqual } from './util';

const DEFAULT_MAX_AGE_SECONDS = 300; // 5 minutes

/**
 * Parse the X-Pierre-Signature header
 * Format: t=<timestamp>,sha256=<signature>
 */
export function parseSignatureHeader(
  header: string
): ParsedWebhookSignature | null {
  if (!header || typeof header !== 'string') {
    return null;
  }

  let timestamp = '';
  let signature = '';

  // Split by comma and parse each element
  const elements = header.split(',');
  for (const element of elements) {
    const trimmedElement = element.trim();
    const parts = trimmedElement.split('=', 2);
    if (parts.length !== 2) {
      continue;
    }

    const [key, value] = parts;
    switch (key) {
      case 't':
        timestamp = value;
        break;
      case 'sha256':
        signature = value;
        break;
    }
  }

  if (!timestamp || !signature) {
    return null;
  }

  return { timestamp, signature };
}

/**
 * Validate a webhook signature and timestamp
 *
 * @param payload - The raw webhook payload (request body)
 * @param signatureHeader - The X-Pierre-Signature header value
 * @param secret - The webhook secret for HMAC verification
 * @param options - Validation options
 * @returns Validation result with details
 *
 * @example
 * ```typescript
 * const result = await validateWebhookSignature(
 *   requestBody,
 *   request.headers['x-pierre-signature'],
 *   webhookSecret
 * );
 *
 * if (!result.valid) {
 *   console.error('Invalid webhook:', result.error);
 *   return;
 * }
 * ```
 */
export async function validateWebhookSignature(
  payload: string | Buffer,
  signatureHeader: string,
  secret: string,
  options: WebhookValidationOptions = {}
): Promise<WebhookValidationResult> {
  if (!secret || secret.length === 0) {
    return {
      valid: false,
      error: 'Empty secret is not allowed',
    };
  }

  // Parse the signature header
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return {
      valid: false,
      error: 'Invalid signature header format',
    };
  }

  // Parse timestamp
  const timestamp = Number.parseInt(parsed.timestamp, 10);
  if (isNaN(timestamp)) {
    return {
      valid: false,
      error: 'Invalid timestamp in signature',
    };
  }

  // Validate timestamp age (prevent replay attacks)
  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  if (maxAge > 0) {
    const now = Math.floor(Date.now() / 1000);
    const age = now - timestamp;

    if (age > maxAge) {
      return {
        valid: false,
        error: `Webhook timestamp too old (${age} seconds)`,
        timestamp,
      };
    }

    // Also reject timestamps from the future (clock skew tolerance of 60 seconds)
    if (age < -60) {
      return {
        valid: false,
        error: 'Webhook timestamp is in the future',
        timestamp,
      };
    }
  }

  // Convert payload to string if it's a Buffer
  const payloadStr =
    typeof payload === 'string' ? payload : payload.toString('utf8');

  // Compute expected signature
  // Format: HMAC-SHA256(secret, timestamp + "." + payload)
  const signedData = `${parsed.timestamp}.${payloadStr}`;
  const expectedSignature = await createHmac('sha256', secret, signedData);

  // Compare signatures using constant-time comparison
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(parsed.signature);

  // Ensure both buffers are the same length for timing-safe comparison
  if (expectedBuffer.length !== actualBuffer.length) {
    return {
      valid: false,
      error: 'Invalid signature',
      timestamp,
    };
  }

  const signaturesMatch = timingSafeEqual(expectedBuffer, actualBuffer);
  if (!signaturesMatch) {
    return {
      valid: false,
      error: 'Invalid signature',
      timestamp,
    };
  }

  return {
    valid: true,
    timestamp,
  };
}

/**
 * Validate a webhook request
 *
 * This is a convenience function that validates the signature and parses the payload.
 *
 * @param payload - The raw webhook payload (request body)
 * @param headers - The request headers (must include x-pierre-signature and x-pierre-event)
 * @param secret - The webhook secret for HMAC verification
 * @param options - Validation options
 * @returns The parsed webhook payload if valid, or validation error
 *
 * @example
 * ```typescript
 * const result = await validateWebhook(
 *   request.body,
 *   request.headers,
 *   process.env.WEBHOOK_SECRET
 * );
 *
 * if (!result.valid) {
 *   return new Response('Invalid webhook', { status: 401 });
 * }
 *
 * // Type-safe access to the webhook payload
 * console.log('Push event:', result.payload);
 * ```
 */
export async function validateWebhook(
  payload: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  options: WebhookValidationOptions = {}
): Promise<WebhookValidationResult & { payload?: WebhookEventPayload }> {
  // Get signature header
  const signatureHeader =
    headers['x-pierre-signature'] || headers['X-Pierre-Signature'];
  if (!signatureHeader || Array.isArray(signatureHeader)) {
    return {
      valid: false,
      error: 'Missing or invalid X-Pierre-Signature header',
    };
  }

  // Get event type header
  const eventType = headers['x-pierre-event'] || headers['X-Pierre-Event'];
  if (!eventType || Array.isArray(eventType)) {
    return {
      valid: false,
      error: 'Missing or invalid X-Pierre-Event header',
    };
  }

  // Validate signature
  const validationResult = await validateWebhookSignature(
    payload,
    signatureHeader,
    secret,
    options
  );

  if (!validationResult.valid) {
    return validationResult;
  }

  // Parse payload
  const payloadStr =
    typeof payload === 'string' ? payload : payload.toString('utf8');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payloadStr);
  } catch {
    return {
      valid: false,
      error: 'Invalid JSON payload',
      timestamp: validationResult.timestamp,
    };
  }

  const conversion = convertWebhookPayload(String(eventType), parsedJson);
  if (!conversion.valid) {
    return {
      valid: false,
      error: conversion.error,
      timestamp: validationResult.timestamp,
    };
  }

  return {
    valid: true,
    eventType,
    timestamp: validationResult.timestamp,
    payload: conversion.payload,
  };
}

function convertWebhookPayload(
  eventType: string,
  raw: unknown
):
  | { valid: true; payload: WebhookEventPayload }
  | { valid: false; error: string } {
  if (eventType === 'push') {
    if (!isRawWebhookPushEvent(raw)) {
      return {
        valid: false,
        error: 'Invalid push payload',
      };
    }
    return {
      valid: true,
      payload: transformPushEvent(raw),
    };
  }
  const fallbackPayload = { type: eventType, raw };
  return {
    valid: true,
    payload: fallbackPayload,
  };
}

function transformPushEvent(raw: RawWebhookPushEvent): WebhookPushEvent {
  return {
    type: 'push' as const,
    repository: {
      id: raw.repository.id,
      url: raw.repository.url,
    },
    ref: raw.ref,
    before: raw.before,
    after: raw.after,
    customerId: raw.customer_id,
    pushedAt: new Date(raw.pushed_at),
    rawPushedAt: raw.pushed_at,
  };
}

function isRawWebhookPushEvent(value: unknown): value is RawWebhookPushEvent {
  if (!isRecord(value)) {
    return false;
  }
  if (!isRecord(value.repository)) {
    return false;
  }
  return (
    typeof value.repository.id === 'string' &&
    typeof value.repository.url === 'string' &&
    typeof value.ref === 'string' &&
    typeof value.before === 'string' &&
    typeof value.after === 'string' &&
    typeof value.customer_id === 'string' &&
    typeof value.pushed_at === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
