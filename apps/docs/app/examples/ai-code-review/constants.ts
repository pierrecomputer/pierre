import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import {
  type DiffLineAnnotation,
  type FileContents,
  parseDiffFromFile,
} from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

export interface AIAnnotation {
  type: 'suggestion' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

const OLD_FILE: FileContents = {
  name: 'auth.ts',
  contents: `import { hash, compare } from 'bcrypt';
import { sign, verify } from 'jsonwebtoken';

const SECRET = 'my-secret-key';
const SALT_ROUNDS = 10;

export async function hashPassword(password: string) {
  return hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hashed: string) {
  return compare(password, hashed);
}

export function createToken(userId: string) {
  return sign({ userId }, SECRET, { expiresIn: '24h' });
}

export function verifyToken(token: string) {
  try {
    return verify(token, SECRET);
  } catch {
    return null;
  }
}
`,
};

const NEW_FILE: FileContents = {
  name: 'auth.ts',
  contents: `import { hash, compare } from 'bcrypt';
import { sign, verify } from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET!;
const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hashed: string
): Promise<boolean> {
  return compare(password, hashed);
}

export function createToken(userId: string, role: string = 'user'): string {
  return sign({ userId, role }, SECRET, { expiresIn: '1h' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return verify(token, SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

interface TokenPayload {
  userId: string;
  role: string;
}
`,
};

const ANNOTATIONS: DiffLineAnnotation<AIAnnotation>[] = [
  {
    side: 'additions',
    lineNumber: 4,
    metadata: {
      type: 'warning',
      message:
        'Using non-null assertion on environment variable. Consider adding runtime validation.',
      suggestion: `const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET not configured');`,
    },
  },
  {
    side: 'additions',
    lineNumber: 18,
    metadata: {
      type: 'suggestion',
      message: 'Consider using a shorter token expiry for better security.',
    },
  },
];

export const AI_CODE_REVIEW_EXAMPLE: PreloadFileDiffOptions<AIAnnotation> = {
  fileDiff: parseDiffFromFile(OLD_FILE, NEW_FILE),
  options: {
    theme: 'pierre-dark',
    diffStyle: 'unified',
    unsafeCSS: CustomScrollbarCSS,
  },
  annotations: ANNOTATIONS,
};
