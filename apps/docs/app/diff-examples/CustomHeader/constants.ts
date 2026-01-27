import { type FileContents, parseDiffFromFile } from '@pierre/diffs';
import type {
  PreloadFileDiffOptions,
  PreloadMultiFileDiffOptions,
} from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const CUSTOM_HEADER_EXAMPLE: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'AppConfig.swift',
    contents: `import Foundation

struct AppConfig {
    static let shared = AppConfig()

    let apiBaseURL: URL
    let timeout: TimeInterval
    let maxRetries: Int

    private init() {
        self.apiBaseURL = URL(string: "https://api.example.com")!
        self.timeout = 30.0
        self.maxRetries = 3
    }

    func headers() -> [String: String] {
        return [
            "Content-Type": "application/json",
            "Accept": "application/json"
        ]
    }
}
`,
  },
  newFile: {
    name: 'AppConfig.swift',
    contents: `import Foundation

struct AppConfig {
    static let shared = AppConfig()

    let apiBaseURL: URL
    let timeout: TimeInterval
    let maxRetries: Int
    let enableLogging: Bool

    private init() {
        self.apiBaseURL = URL(string: "https://api.example.com/v2")!
        self.timeout = 60.0
        self.maxRetries = 5
        self.enableLogging = true
    }

    func headers(token: String? = nil) -> [String: String] {
        var headers = [
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-API-Version": "2.0"
        ]
        if let token = token {
            headers["Authorization"] = "Bearer \\(token)"
        }
        return headers
    }
}
`,
  },
  options: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    themeType: 'dark',
    diffStyle: 'split',
    disableBackground: false,
    unsafeCSS: CustomScrollbarCSS,
  },
};

const FULL_CUSTOM_OLD_FILE: FileContents = {
  name: 'utils.ts',
  contents: `// String utilities
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

// Array utilities
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Object utilities
export function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    result[key] = obj[key];
  }
  return result;
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
`,
};

const FULL_CUSTOM_NEW_FILE: FileContents = {
  name: 'utils.ts',
  contents: `// String utilities
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function truncate(str: string, max: number, ellipsis = '…'): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + ellipsis;
}

// Array utilities
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

// Object utilities
export function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    result[key] = obj[key];
  }
  return result;
}

export function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}
`,
};

export const FULL_CUSTOM_HEADER_EXAMPLE: PreloadFileDiffOptions<undefined> = {
  fileDiff: parseDiffFromFile(FULL_CUSTOM_OLD_FILE, FULL_CUSTOM_NEW_FILE),
  options: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    themeType: 'dark',
    diffStyle: 'unified',
    disableFileHeader: true,
    unsafeCSS: CustomScrollbarCSS,
  },
};
