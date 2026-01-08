import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import { type FileContents, parseDiffFromFile } from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

const OLD_FILE: FileContents = {
  name: 'api/users.ts',
  contents: `export async function getUser(id: string) {
  const response = await fetch(\`/api/users/\${id}\`);
  return response.json();
}

export async function updateUser(id: string, data: any) {
  const response = await fetch(\`/api/users/\${id}\`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return response.json();
}
`,
};

const NEW_FILE: FileContents = {
  name: 'api/users.ts',
  contents: `import { z } from 'zod';

const UserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['admin', 'user', 'guest']),
});

export async function getUser(id: string) {
  const response = await fetch(\`/api/users/\${id}\`);
  if (!response.ok) {
    throw new Error(\`Failed to fetch user: \${response.status}\`);
  }
  return response.json();
}

export async function updateUser(id: string, data: z.infer<typeof UserSchema>) {
  const validated = UserSchema.parse(data);
  const response = await fetch(\`/api/users/\${id}\`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated),
  });
  if (!response.ok) {
    throw new Error(\`Failed to update user: \${response.status}\`);
  }
  return response.json();
}
`,
};

export const HOVER_ACTIONS_EXAMPLE: PreloadFileDiffOptions<undefined> = {
  fileDiff: parseDiffFromFile(OLD_FILE, NEW_FILE),
  options: {
    theme: 'pierre-dark',
    diffStyle: 'unified',
    unsafeCSS: CustomScrollbarCSS,
    enableHoverUtility: true,
  },
};
