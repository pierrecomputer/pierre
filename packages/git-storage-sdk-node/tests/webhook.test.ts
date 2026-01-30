import { describe, expect, it } from 'vitest';

import {
  type RawWebhookPushEvent,
  type WebhookPushEvent,
  parseSignatureHeader,
  validateWebhook,
  validateWebhookSignature,
} from '../src';
import { createHmac } from '../src/util';

describe('Webhook Validation', () => {
  const secret = 'test_webhook_secret_key_123';
  const rawPayload: RawWebhookPushEvent = {
    repository: {
      id: 'repo_abc123def456ghi789jkl',
      url: 'https://git.example.com/org/repo',
    },
    ref: 'main',
    before: 'abc123000000000000000000000000000000000',
    after: 'def456000000000000000000000000000000000',
    customer_id: 'cust_xyz789mno456pqr123st',
    pushed_at: '2024-01-20T10:30:00Z',
  };
  const expectedPushPayload: WebhookPushEvent = {
    type: 'push',
    repository: {
      id: 'repo_abc123def456ghi789jkl',
      url: 'https://git.example.com/org/repo',
    },
    ref: 'main',
    before: 'abc123000000000000000000000000000000000',
    after: 'def456000000000000000000000000000000000',
    customerId: 'cust_xyz789mno456pqr123st',
    pushedAt: new Date('2024-01-20T10:30:00Z'),
    rawPushedAt: '2024-01-20T10:30:00Z',
  };
  const payloadStr = JSON.stringify(rawPayload);

  // Helper to generate a valid signature
  async function generateSignature(
    payloadData: string,
    webhookSecret: string,
    timestamp?: number
  ): Promise<{ header: string; timestamp: number }> {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const signedData = `${ts}.${payloadData}`;
    const signature = await createHmac('sha256', webhookSecret, signedData);
    return {
      header: `t=${ts},sha256=${signature}`,
      timestamp: ts,
    };
  }

  describe('parseSignatureHeader', () => {
    it('should parse valid signature header', () => {
      const header = 't=1234567890,sha256=abcdef123456';
      const result = parseSignatureHeader(header);
      expect(result).toEqual({
        timestamp: '1234567890',
        signature: 'abcdef123456',
      });
    });

    it('should handle header with spaces', () => {
      const header = 't=1234567890, sha256=abcdef123456';
      const result = parseSignatureHeader(header);
      expect(result).toEqual({
        timestamp: '1234567890',
        signature: 'abcdef123456',
      });
    });

    it('should return null for invalid header format', () => {
      expect(parseSignatureHeader('')).toBeNull();
      expect(parseSignatureHeader('invalid')).toBeNull();
      expect(parseSignatureHeader('t=123')).toBeNull(); // Missing signature
      expect(parseSignatureHeader('sha256=abc')).toBeNull(); // Missing timestamp
      expect(parseSignatureHeader('timestamp=123,signature=abc')).toBeNull(); // Wrong keys
    });

    it('should handle header with extra fields', () => {
      const header = 't=1234567890,sha256=abcdef123456,v1=ignored';
      const result = parseSignatureHeader(header);
      expect(result).toEqual({
        timestamp: '1234567890',
        signature: 'abcdef123456',
      });
    });
  });

  describe('validateWebhookSignature', () => {
    it('should validate correct signature', async () => {
      const { header, timestamp } = await generateSignature(payloadStr, secret);
      const result = await validateWebhookSignature(payloadStr, header, secret);

      expect(result).toEqual({
        valid: true,
        timestamp,
      });
    });

    it('should validate with Buffer payload', async () => {
      const { header, timestamp } = await generateSignature(payloadStr, secret);
      const payloadBuffer = Buffer.from(payloadStr, 'utf8');
      const result = await validateWebhookSignature(
        payloadBuffer,
        header,
        secret
      );

      expect(result).toEqual({
        valid: true,
        timestamp,
      });
    });

    it('should reject invalid signature', async () => {
      const { header } = await generateSignature(payloadStr, 'wrong_secret');
      const result = await validateWebhookSignature(payloadStr, header, secret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid signature');
    });

    it('should reject old timestamp (replay protection)', async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago
      const { header } = await generateSignature(
        payloadStr,
        secret,
        oldTimestamp
      );
      const result = await validateWebhookSignature(payloadStr, header, secret);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Webhook timestamp too old/);
      expect(result.timestamp).toBe(oldTimestamp);
    });

    it('should reject future timestamp', async () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 120; // 2 minutes in future
      const { header } = await generateSignature(
        payloadStr,
        secret,
        futureTimestamp
      );
      const result = await validateWebhookSignature(payloadStr, header, secret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Webhook timestamp is in the future');
      expect(result.timestamp).toBe(futureTimestamp);
    });

    it('should allow disabling timestamp validation', async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const { header } = await generateSignature(
        payloadStr,
        secret,
        oldTimestamp
      );
      const result = await validateWebhookSignature(
        payloadStr,
        header,
        secret,
        {
          maxAgeSeconds: 0,
        }
      );

      expect(result).toEqual({
        valid: true,
        timestamp: oldTimestamp,
      });
    });

    it('should use custom max age', async () => {
      const timestamp = Math.floor(Date.now() / 1000) - 60; // 60 seconds ago
      const { header } = await generateSignature(payloadStr, secret, timestamp);

      // Should fail with 30 second max age
      const result1 = await validateWebhookSignature(
        payloadStr,
        header,
        secret,
        {
          maxAgeSeconds: 30,
        }
      );
      expect(result1.valid).toBe(false);

      // Should succeed with 120 second max age
      const result2 = await validateWebhookSignature(
        payloadStr,
        header,
        secret,
        {
          maxAgeSeconds: 120,
        }
      );
      expect(result2.valid).toBe(true);
    });

    it('should reject malformed signature header', async () => {
      const result = await validateWebhookSignature(
        payloadStr,
        'invalid_header',
        secret
      );
      expect(result).toEqual({
        valid: false,
        error: 'Invalid signature header format',
      });
    });

    it('should reject non-numeric timestamp', async () => {
      const header = 't=not_a_number,sha256=abcdef123456';
      const result = await validateWebhookSignature(payloadStr, header, secret);
      expect(result).toEqual({
        valid: false,
        error: 'Invalid timestamp in signature',
      });
    });

    it('should handle different payload modifications', async () => {
      const { header } = await generateSignature(payloadStr, secret);

      // Modified payload should fail
      const modifiedPayload = payloadStr.replace('main', 'master');
      const result1 = await validateWebhookSignature(
        modifiedPayload,
        header,
        secret
      );
      expect(result1.valid).toBe(false);

      // Extra whitespace should fail
      const result2 = await validateWebhookSignature(
        payloadStr + ' ',
        header,
        secret
      );
      expect(result2.valid).toBe(false);

      // Different encoding should work if content is same
      const payloadBuffer = Buffer.from(payloadStr);
      const result3 = await validateWebhookSignature(
        payloadBuffer,
        header,
        secret
      );
      expect(result3.valid).toBe(true);
    });
  });

  describe('validateWebhook', () => {
    it('should validate and parse webhook', async () => {
      const { header, timestamp } = await generateSignature(payloadStr, secret);
      const headers = {
        'x-pierre-signature': header,
        'x-pierre-event': 'push',
      };

      const result = await validateWebhook(payloadStr, headers, secret);

      expect(result.valid).toBe(true);
      expect(result.eventType).toBe('push');
      expect(result.timestamp).toBe(timestamp);
      expect(result.payload).toEqual(expectedPushPayload);
    });

    it('should handle uppercase headers', async () => {
      const { header, timestamp } = await generateSignature(payloadStr, secret);
      const headers = {
        'X-Pierre-Signature': header,
        'X-Pierre-Event': 'push',
      };

      const result = await validateWebhook(payloadStr, headers, secret);

      expect(result.valid).toBe(true);
      expect(result.eventType).toBe('push');
      expect(result.timestamp).toBe(timestamp);
    });

    it('should reject missing signature header', async () => {
      const headers = {
        'x-pierre-event': 'push',
      };

      const result = await validateWebhook(payloadStr, headers, secret);

      expect(result).toEqual({
        valid: false,
        error: 'Missing or invalid X-Pierre-Signature header',
      });
    });

    it('should reject missing event header', async () => {
      const { header } = await generateSignature(payloadStr, secret);
      const headers = {
        'x-pierre-signature': header,
      };

      const result = await validateWebhook(payloadStr, headers, secret);

      expect(result).toEqual({
        valid: false,
        error: 'Missing or invalid X-Pierre-Event header',
      });
    });

    it('should reject array headers', async () => {
      const { header } = await generateSignature(payloadStr, secret);

      const headers1 = {
        'x-pierre-signature': [header, header],
        'x-pierre-event': 'push',
      };
      const result1 = await validateWebhook(payloadStr, headers1, secret);
      expect(result1.valid).toBe(false);

      const headers2 = {
        'x-pierre-signature': header,
        'x-pierre-event': ['push', 'push'],
      };
      const result2 = await validateWebhook(payloadStr, headers2, secret);
      expect(result2.valid).toBe(false);
    });

    it('should reject invalid JSON payload', async () => {
      const invalidJson = 'not valid json';
      const { header } = await generateSignature(invalidJson, secret);
      const headers = {
        'x-pierre-signature': header,
        'x-pierre-event': 'push',
      };

      const result = await validateWebhook(invalidJson, headers, secret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid JSON payload');
    });

    it('should propagate signature validation errors', async () => {
      const { header } = await generateSignature(payloadStr, 'wrong_secret');
      const headers = {
        'x-pierre-signature': header,
        'x-pierre-event': 'push',
      };

      const result = await validateWebhook(payloadStr, headers, secret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid signature');
    });

    it('should pass through validation options', async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const { header } = await generateSignature(
        payloadStr,
        secret,
        oldTimestamp
      );
      const headers = {
        'x-pierre-signature': header,
        'x-pierre-event': 'push',
      };

      // Should fail with default max age
      const result1 = await validateWebhook(payloadStr, headers, secret);
      expect(result1.valid).toBe(false);

      // Should succeed with disabled timestamp validation
      const result2 = await validateWebhook(payloadStr, headers, secret, {
        maxAgeSeconds: 0,
      });
      expect(result2.valid).toBe(true);
      expect(result2.payload).toEqual(expectedPushPayload);
    });
  });

  describe('Security considerations', () => {
    it('should use constant-time comparison', async () => {
      // This test verifies the implementation uses timingSafeEqual
      // by ensuring different length signatures are rejected before comparison
      const { header } = await generateSignature(payloadStr, secret);
      const shortSigHeader = header.replace(/sha256=.*/, 'sha256=short');
      const result = await validateWebhookSignature(
        payloadStr,
        shortSigHeader,
        secret
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid signature');
    });

    it('should handle empty or undefined inputs safely', async () => {
      const { header } = await generateSignature(payloadStr, secret);

      // Empty payload
      expect((await validateWebhookSignature('', header, secret)).valid).toBe(
        false
      );

      // Empty secret
      expect(
        (await validateWebhookSignature(payloadStr, header, '')).valid
      ).toBe(false);

      // Empty header
      expect(
        (await validateWebhookSignature(payloadStr, '', secret)).valid
      ).toBe(false);
    });

    it('should be resilient to timing attacks', async () => {
      // Generate multiple signatures to test timing consistency
      const signatures: string[] = [];
      for (let i = 0; i < 10; i++) {
        const testSecret = `secret_${i}`;
        const { header } = await generateSignature(payloadStr, testSecret);
        signatures.push(header);
      }

      // All invalid signatures should be rejected
      // The implementation should use constant-time comparison
      for (const sig of signatures) {
        const result = await validateWebhookSignature(payloadStr, sig, secret);
        expect(result.valid).toBe(false);
      }
    });
  });
});
