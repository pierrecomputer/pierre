import { DEFAULT_THEMES, type FileContents } from '@pierre/diffs';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const CUSTOM_HEADER_OLD_FILE: FileContents = {
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
};

const CUSTOM_HEADER_NEW_FILE: FileContents = {
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
};

export const CUSTOM_HEADER_EXAMPLE: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: CUSTOM_HEADER_OLD_FILE,
  newFile: CUSTOM_HEADER_NEW_FILE,
  options: {
    theme: DEFAULT_THEMES,
    themeType: 'dark',
    diffStyle: 'split',
    disableBackground: false,
    unsafeCSS: CustomScrollbarCSS,
  },
};
