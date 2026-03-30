import {
  DEFAULT_THEMES,
  type DiffLineAnnotation,
  type FileContents,
  parseDiffFromFile,
} from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

export interface AcceptRejectMetadata {
  key: string;
  accepted?: boolean;
}

const ACCEPT_REJECT_OLD_FILE: FileContents = {
  name: 'index.html',
  contents: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Welcome</title>
</head>
<body>
  <header>
    <h1>Welcome</h1>
    <p>Thanks for visiting</p>
  </header>
  <footer>
    <p>&copy; Acme Inc.</p>
  </footer>
</body>
</html>
`,
};

const ACCEPT_REJECT_NEW_FILE: FileContents = {
  name: 'index.html',
  contents: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Welcome</title>
</head>
<body>
  <header>
    <h1>Welcome to Our Site</h1>
    <p>We're glad you're here</p>
    <a href="/about" class="btn">Learn More</a>
  </header>
  <footer>
    <p>&copy; Acme Inc.</p>
  </footer>
</body>
</html>
`,
};

const ACCEPT_REJECT_ANNOTATIONS: DiffLineAnnotation<AcceptRejectMetadata>[] = [
  { side: 'additions', lineNumber: 11, metadata: { key: 'del-11' } },
];

export const ACCEPT_REJECT_EXAMPLE: PreloadFileDiffOptions<AcceptRejectMetadata> =
  {
    fileDiff: parseDiffFromFile(ACCEPT_REJECT_OLD_FILE, ACCEPT_REJECT_NEW_FILE),
    options: {
      theme: DEFAULT_THEMES,
      themeType: 'dark',
      diffStyle: 'unified',
    },
    annotations: ACCEPT_REJECT_ANNOTATIONS,
  };
