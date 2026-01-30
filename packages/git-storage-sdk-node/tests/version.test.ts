import { describe, expect, it } from 'vitest';

import packageJson from '../package.json';
import { PACKAGE_NAME, PACKAGE_VERSION, getUserAgent } from '../src/version';

describe('version', () => {
  describe('PACKAGE_NAME', () => {
    it('should export the correct package name', () => {
      expect(PACKAGE_NAME).toBe('code-storage-sdk');
    });
  });

  describe('PACKAGE_VERSION', () => {
    it('should export the correct package version', () => {
      expect(PACKAGE_VERSION).toBe(packageJson.version);
    });

    it('should follow semantic versioning format', () => {
      // Check if version follows semver pattern (e.g., 0.3.0, 1.0.0, 1.2.3-beta.1)
      const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
      expect(PACKAGE_VERSION).toMatch(semverPattern);
    });
  });

  describe('getUserAgent', () => {
    it('should return a valid user agent string', () => {
      const userAgent = getUserAgent();
      expect(userAgent).toBeDefined();
      expect(typeof userAgent).toBe('string');
    });

    it('should format user agent as "{name}/{version}"', () => {
      const userAgent = getUserAgent();
      expect(userAgent).toBe(`${PACKAGE_NAME}/${PACKAGE_VERSION}`);
    });

    it('should return a non-empty string', () => {
      const userAgent = getUserAgent();
      expect(userAgent.length).toBeGreaterThan(0);
    });

    it('should contain the package name', () => {
      const userAgent = getUserAgent();
      expect(userAgent).toContain('code-storage-sdk');
    });

    it('should contain the version number', () => {
      const userAgent = getUserAgent();
      expect(userAgent).toContain(packageJson.version);
    });

    it('should return consistent value across multiple calls', () => {
      const userAgent1 = getUserAgent();
      const userAgent2 = getUserAgent();
      expect(userAgent1).toBe(userAgent2);
    });

    it('should match the expected format pattern', () => {
      const userAgent = getUserAgent();
      // Pattern: name/version
      const pattern = /^[\w-]+\/\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
      expect(userAgent).toMatch(pattern);
    });
  });
});
