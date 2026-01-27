import {
  type DiffLineAnnotation,
  type FileContents,
  parseDiffFromFile,
} from '@pierre/diffs';
import type {
  PreloadFileDiffOptions,
  PreloadMultiFileDiffOptions,
} from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export interface AnnotationMetadata {
  key: string;
  isThread: boolean;
}

export const ANNOTATION_EXAMPLE: PreloadMultiFileDiffOptions<AnnotationMetadata> =
  {
    oldFile: {
      name: 'auth.py',
      contents: `import jwt
import time
from typing import Optional

SECRET_KEY = "your-secret-key"

def create_token(user_id: str, expires_in: int = 3600) -> str:
    payload = {
        "sub": user_id,
        "exp": time.time() + expires_in
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def verify_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        if payload["exp"] < time.time():
            return None
        return payload["sub"]
    except jwt.InvalidTokenError:
        return None
`,
    },
    newFile: {
      name: 'auth.py',
      contents: `import jwt
import time
from typing import Optional

SECRET_KEY = "your-secret-key"

def create_token(user_id: str, role: str = "user", expires_in: int = 3600) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": time.time() + expires_in
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def verify_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        if payload["exp"] < time.time():
            return None
        return {"user_id": payload["sub"], "role": payload["role"]}
    except jwt.InvalidTokenError:
        return None
`,
    },
    options: {
      theme: 'pierre-dark',
      diffStyle: 'unified',
      unsafeCSS: CustomScrollbarCSS,
    },
    annotations: [
      {
        side: 'additions',
        lineNumber: 20,
        metadata: {
          key: 'additions-20',
          isThread: true,
        },
      },
    ],
  };

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
      theme: 'pierre-dark',
      diffStyle: 'unified',
    },
    annotations: ACCEPT_REJECT_ANNOTATIONS,
  };
