import { describe, expect, test } from 'bun:test';

import {
  distTagAddArgs,
  dryRunPublishArgs,
  parseArgs,
  publishArgs,
  redactOtp,
} from '../scripts/publish';

describe('trees publish script OTP handling', () => {
  test('parseArgs accepts inline and separated OTP values', () => {
    expect(parseArgs(['--tag=latest', '--otp=123456'])).toMatchObject({
      otp: '123456',
      tag: 'latest',
    });
    expect(parseArgs(['--otp', '654321'])).toMatchObject({
      otp: '654321',
      tag: 'beta',
    });
  });

  test('parseArgs rejects missing OTP values', () => {
    expect(() => parseArgs(['--otp'])).toThrow(
      '--otp requires a one-time password'
    );
    expect(() => parseArgs(['--otp='])).toThrow(
      '--otp requires a one-time password'
    );
    expect(() => parseArgs(['--otp', '--tag=beta'])).toThrow(
      '--otp requires a one-time password'
    );
  });

  test('pnpm publish commands forward OTP without changing release args', () => {
    expect(publishArgs('/tmp/pierre-trees.tgz', 'beta', '123456')).toEqual([
      'publish',
      '/tmp/pierre-trees.tgz',
      '--tag',
      'beta',
      '--no-git-checks',
      '--otp',
      '123456',
    ]);
    expect(
      dryRunPublishArgs('/tmp/pierre-trees.tgz', 'beta', '123456')
    ).toEqual([
      'publish',
      '/tmp/pierre-trees.tgz',
      '--dry-run',
      '--tag',
      'beta',
      '--no-git-checks',
      '--otp',
      '123456',
    ]);
    expect(distTagAddArgs('1.0.0-beta.6', '123456')).toEqual([
      'dist-tag',
      'add',
      '@pierre/trees@1.0.0-beta.6',
      'latest',
      '--otp',
      '123456',
    ]);
  });

  test('OTP values are redacted before commands are logged', () => {
    expect(
      redactOtp(publishArgs('/tmp/pierre-trees.tgz', 'beta', '123456'))
    ).toEqual([
      'publish',
      '/tmp/pierre-trees.tgz',
      '--tag',
      'beta',
      '--no-git-checks',
      '--otp',
      '<redacted>',
    ]);
    expect(redactOtp(['publish', 'package.tgz', '--otp=123456'])).toEqual([
      'publish',
      'package.tgz',
      '--otp=<redacted>',
    ]);
  });
});
