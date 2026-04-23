import { DEFAULT_THEMES } from '@pierre/diffs';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

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
      theme: DEFAULT_THEMES,
      themeType: 'dark',
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
