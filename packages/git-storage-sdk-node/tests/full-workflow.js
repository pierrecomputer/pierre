#!/usr/bin/env node

/**
 * Git3P Full Workflow smoke test driven by the GitStorage SDK.
 *
 * This script mirrors the behaviour of
 * git3p-backend/hack/test-scripts/test-full-workflow.sh using the SDK instead
 * of shelling out to git, curl, or Go helpers.
 *
 * Run with:
 *   node packages/git-storage-sdk/tests/full-workflow.js
 *
 * The script expects the Git3P backend + storage services to be reachable. By
 * default it targets the local environment and uses the dev private key bundled
 * in the repository. Override behaviour via the environment variables below:
 *
 *   GIT_STORAGE_ENV                - local | staging | prod | production (default: local)
 *   GIT_STORAGE_API_BASE_URL       - overrides API base URL
 *   GIT_STORAGE_STORAGE_BASE_URL   - overrides storage host (hostname:port)
 *   GIT_STORAGE_NAME               - customer namespace / issuer (default derived from env)
 *   GIT_STORAGE_SUBDOMAIN          - used when env !== local and NAME not provided
 *   GIT_STORAGE_DEFAULT_BRANCH     - default branch name (default: main)
 *   GIT_STORAGE_REPO_ID            - optional repo id override
 *   GIT_STORAGE_KEY_PATH           - path to signing key (default: dev key)
 *
 * CLI flags override the environment variables above:
 *   -e, --environment ENV          - local | staging | prod | production
 *   -k, --key PATH                 - path to signing key
 *   -s, --subdomain NAME           - customer subdomain (staging/prod/production)
 *   -n, --namespace NAME           - explicit namespace override
 *   -r, --repo NAME                - repository id override
 *       --api-base-url URL         - override API base URL
 *       --storage-base-url HOST    - override storage host
 *       --timeout MS               - override timeout in milliseconds
 *       --key-id ID                - JWT kid value override
 *   -h, --help                     - show this help text
 *
 * The script is idempotent per unique repo id – it always creates a fresh repo.
 */
import { SignJWT, importPKCS8 } from 'jose';
import { createHash, createPrivateKey } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultKeyPath = path.resolve(
  __dirname,
  '../../../git3p-backend/hack/test-scripts/dev-keys/private.pem'
);

function gitBlobSha(contents) {
  const buffer = Buffer.from(contents, 'utf8');
  const header = `blob ${buffer.byteLength}\0`;
  return createHash('sha1').update(header).update(buffer).digest('hex');
}

function normalizeEnvironment(value) {
  if (!value) {
    return 'local';
  }
  const normalized = value.toLowerCase();
  if (normalized === 'local') {
    return 'local';
  }
  if (normalized === 'stage' || normalized === 'staging') {
    return 'staging';
  }
  if (normalized === 'prod' || normalized === 'production') {
    return 'production';
  }
  throw new Error(
    `Unsupported environment "${value}". Expected one of: local, staging, prod, production.`
  );
}

function applyOrgPlaceholder(value, org) {
  if (!value) {
    return value;
  }
  return value.includes('{{org}}') ? value.replace('{{org}}', org) : value;
}

function printUsage() {
  const scriptName = path.relative(process.cwd(), __filename);
  console.log(
    [
      `Usage: node ${scriptName} [options]`,
      '',
      'Options:',
      '  -e, --environment ENV        Target environment (local|staging|prod|production)',
      '  -k, --key PATH               Path to signing key PEM',
      '  -s, --subdomain NAME         Customer subdomain for non-local environments',
      '  -n, --namespace NAME         Explicit namespace override',
      '  -r, --repo NAME              Repository identifier override',
      '      --api-base-url URL       Override API base URL',
      '      --storage-base-url HOST  Override storage host (hostname[:port])',
      '      --timeout MS             Override timeout in milliseconds',
      '      --key-id ID              Override JWT key identifier',
      '  -h, --help                   Show this help text and exit',
      '',
      'Environment variables can also be used (see script header for details).',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const next = argv[index + 1];
      if (!next) {
        throw new Error(`Missing value for option "${arg}"`);
      }
      index += 1;
      return next;
    };

    switch (arg) {
      case '-e':
      case '--environment':
        options.environment = readValue();
        break;
      case '-k':
      case '--key':
        options.keyPath = readValue();
        break;
      case '-s':
      case '--subdomain':
        options.subdomain = readValue();
        break;
      case '-n':
      case '--namespace':
        options.namespace = readValue();
        break;
      case '-r':
      case '--repo':
        options.repoId = readValue();
        break;
      case '--api-base-url':
        options.apiBaseUrl = readValue();
        break;
      case '--storage-base-url':
        options.storageBaseUrl = readValue();
        break;
      case '--timeout':
        options.timeout = readValue();
        break;
      case '--key-id':
        options.keyId = readValue();
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option "${arg}"`);
        }
        throw new Error(`Unexpected argument "${arg}"`);
    }
  }
  return options;
}

let cliOptions;
try {
  cliOptions = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : 'Failed to parse command line arguments.'
  );
  printUsage();
  process.exit(1);
}

if (cliOptions?.help) {
  printUsage();
  process.exit(0);
}

const env = {
  runEnv: normalizeEnvironment(process.env.GIT_STORAGE_ENV ?? 'local'),
  apiBaseUrl: process.env.GIT_STORAGE_API_BASE_URL,
  storageBaseUrl: process.env.GIT_STORAGE_STORAGE_BASE_URL,
  namespace: process.env.GIT_STORAGE_NAME,
  subdomain: process.env.GIT_STORAGE_SUBDOMAIN,
  defaultBranch: process.env.GIT_STORAGE_DEFAULT_BRANCH ?? 'main',
  repoId: process.env.GIT_STORAGE_REPO_ID,
  keyPath: process.env.GIT_STORAGE_KEY_PATH ?? defaultKeyPath,
  keyId: process.env.GIT_STORAGE_KEY_ID ?? 'dev-key-001',
  timeoutMs: process.env.GIT_STORAGE_TIMEOUT
    ? Number.parseInt(process.env.GIT_STORAGE_TIMEOUT, 10)
    : undefined,
};

if (cliOptions?.environment) {
  env.runEnv = normalizeEnvironment(cliOptions.environment);
}
if (cliOptions?.apiBaseUrl) {
  env.apiBaseUrl = cliOptions.apiBaseUrl;
}
if (cliOptions?.storageBaseUrl) {
  env.storageBaseUrl = cliOptions.storageBaseUrl;
}
if (cliOptions?.namespace) {
  env.namespace = cliOptions.namespace;
}
if (cliOptions?.subdomain) {
  env.subdomain = cliOptions.subdomain;
}
if (cliOptions?.repoId) {
  env.repoId = cliOptions.repoId;
}
if (cliOptions?.keyPath) {
  env.keyPath = path.resolve(cliOptions.keyPath);
}
if (cliOptions?.keyId) {
  env.keyId = cliOptions.keyId;
}
if (cliOptions?.timeout) {
  const parsedTimeout = Number.parseInt(cliOptions.timeout, 10);
  if (Number.isNaN(parsedTimeout) || parsedTimeout <= 0) {
    console.error(
      `Invalid timeout value "${cliOptions.timeout}". Expected a positive integer in milliseconds.`
    );
    printUsage();
    process.exit(1);
  }
  env.timeoutMs = parsedTimeout;
}

const KEY_CACHE = new Map();

const JSON_BODY_PREVIEW_LIMIT = 1_024;
if (typeof Response !== 'undefined' && Response.prototype?.json) {
  const originalResponseJson = Response.prototype.json;
  Response.prototype.json = async function patchedJson(...args) {
    try {
      return await originalResponseJson.apply(this, args);
    } catch (error) {
      if (error instanceof SyntaxError) {
        let bodyPreview = '<unavailable>';
        try {
          const clone = this.clone();
          const text = await clone.text();
          bodyPreview =
            text.length > JSON_BODY_PREVIEW_LIMIT
              ? `${text.slice(0, JSON_BODY_PREVIEW_LIMIT)}...`
              : text;
        } catch (readError) {
          const reason =
            readError instanceof Error ? readError.message : String(readError);
          bodyPreview = `<failed to read response body: ${reason}>`;
        }

        const context = {
          url: this.url ?? '<unknown>',
          status: this.status ?? '<unknown>',
          statusText: this.statusText ?? '<unknown>',
          bodyPreview,
        };

        try {
          const headers = {};
          for (const [key, value] of this.headers.entries()) {
            headers[key] = value;
          }
          context.headers = headers;
        } catch {
          // Ignore header extraction failures.
        }

        console.error('WARNING: Failed to parse JSON response.', context);
      }
      throw error;
    }
  };
}

function resolveDistEntry() {
  const esmPath = path.resolve(__dirname, '../dist/index.js');
  if (existsSync(esmPath)) {
    return esmPath;
  }
  return null;
}

async function loadGitStorage() {
  const distEntry = resolveDistEntry();
  if (!distEntry) {
    throw new Error(
      [
        'GitStorage dist build not found.',
        'Run "pnpm --filter @pierre/storage build" before executing this script,',
        'or provide a compiled dist at packages/git-storage-sdk/dist/index.js.',
      ].join(' ')
    );
  }
  const module = await import(pathToFileURL(distEntry).href);
  if (!module.GitStorage) {
    throw new Error(`GitStorage export missing from ${distEntry}`);
  }
  patchGitStorage(module.GitStorage);
  return module.GitStorage;
}

async function waitFor(check, options = {}) {
  const {
    timeout = 120_000,
    interval = 2_000,
    description,
    isFatalError,
    onRetry,
  } = options;
  const deadline = Date.now() + timeout;
  let lastError;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      if (typeof isFatalError === 'function' && isFatalError(error)) {
        throw error;
      }
      lastError = error;
      if (typeof onRetry === 'function') {
        onRetry({ attempt, error });
      }
    }
    if (!lastError && typeof onRetry === 'function') {
      onRetry({ attempt });
    }
    await delay(interval);
  }

  const message = description
    ? `Timed out waiting for ${description}`
    : 'Timed out waiting for condition';
  if (lastError instanceof Error) {
    throw new Error(message, { cause: lastError });
  }
  throw new Error(message);
}

async function main() {
  if (!existsSync(env.keyPath)) {
    throw new Error(
      `Signing key not found at ${env.keyPath}. Set GIT_STORAGE_KEY_PATH to override.`
    );
  }

  const key = await readFile(env.keyPath, 'utf8');

  const namespace =
    env.namespace ??
    (env.runEnv === 'local'
      ? 'local'
      : (env.subdomain ??
        (() => {
          throw new Error(
            'Set GIT_STORAGE_NAME or GIT_STORAGE_SUBDOMAIN when targeting non-local environments.'
          );
        })()));

  const namespaceSlug = namespace.toLowerCase();

  const apiBaseUrl = applyOrgPlaceholder(
    env.apiBaseUrl ??
      (env.runEnv === 'local'
        ? 'http://127.0.0.1:8081'
        : env.runEnv === 'staging'
          ? 'https://api.{{org}}.3p.pierre.rip'
          : 'https://api.{{org}}.code.storage'),
    namespaceSlug
  );

  const storageBaseUrl = applyOrgPlaceholder(
    env.storageBaseUrl ??
      (env.runEnv === 'local'
        ? '127.0.0.1:8080'
        : env.runEnv === 'staging'
          ? '{{org}}.3p.pierre.rip'
          : '{{org}}.code.storage'),
    namespaceSlug
  );

  const repoId = env.repoId ?? `sdk-full-workflow-${Date.now()}`;
  const defaultBranch = env.defaultBranch;
  const timeout = env.timeoutMs ?? 180_000;
  const grepToken = `SDK_GREP_${repoId}`;

  console.log(`▶ GitStorage full workflow`);
  console.log(`  Environment: ${env.runEnv}`);
  console.log(`  Namespace:   ${namespace}`);
  console.log(`  API base:    ${apiBaseUrl}`);
  console.log(`  Storage host:${storageBaseUrl}`);
  console.log(`  Repo ID:     ${repoId}`);
  console.log(`  Timeout:     ${timeout / 1000}s`);

  const GitStorage = await loadGitStorage();
  const store = new GitStorage({
    name: namespace,
    key,
    apiBaseUrl,
    storageBaseUrl,
  });

  const repo = await store.createRepo({ id: repoId, defaultBranch });
  console.log(`✓ Repository created (${repo.id})`);

  const signature = () => ({
    name: 'SDK Committer',
    email: 'sdk@example.com',
  });

  const initialSig = signature();
  const initialCommit = await repo
    .createCommit({
      targetBranch: defaultBranch,
      commitMessage: 'Initial commit: Add README via SDK',
      author: initialSig,
      committer: initialSig,
    })
    .addFileFromString(
      'README.md',
      [
        `# ${repoId}`,
        '',
        'This repository is created by the GitStorage SDK full workflow script.',
        '',
        `Grep marker: ${grepToken}`,
        'Case marker: ONLYUPPERCASE',
      ].join('\n'),
      { encoding: 'utf-8' }
    )
    .send();
  const baselineCommitSha = initialCommit.commitSha;
  let latestCommitSha = baselineCommitSha;
  console.log(`✓ Initial commit pushed (${latestCommitSha})`);

  await waitFor(
    async () => {
      const branches = await repo.listBranches({ limit: 10 });
      return branches.branches.find(
        (branch) =>
          branch.name === defaultBranch && branch.headSha === latestCommitSha
      );
    },
    {
      timeout,
      description: `default branch ${defaultBranch} to include initial commit`,
    }
  );
  console.log(`✓ Default branch updated (${defaultBranch})`);

  await waitFor(
    async () => {
      const commits = await repo.listCommits({
        branch: defaultBranch,
        limit: 5,
      });
      return commits.commits.find((commit) => commit.sha === latestCommitSha);
    },
    { timeout, description: 'initial commit to appear in commit list' }
  );
  console.log(`✓ Commit listing reflects initial commit`);

  if (typeof repo.grep !== 'function') {
    throw new Error(
      [
        'This repo instance does not expose repo.grep().',
        'The full-workflow script loads the SDK from packages/git-storage-sdk/dist, which is likely stale.',
        'Run "pnpm --filter @pierre/storage build" and retry.',
      ].join(' ')
    );
  }

  await waitFor(
    async () => {
      const result = await repo.grep({
        ref: defaultBranch,
        query: { pattern: 'onlyuppercase', caseSensitive: true },
        limits: { maxLines: 5 },
      });

      if (result.matches.length !== 0) {
        throw new Error(
          `Expected case-sensitive grep to return zero matches, got ${result.matches.length}`
        );
      }

      return result;
    },
    {
      timeout,
      description:
        'grep API to return empty results for case-sensitive mismatch',
      isFatalError: (error) =>
        error instanceof TypeError ||
        (error?.name === 'ApiError' &&
          typeof error.status === 'number' &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429),
      onRetry: ({ attempt, error }) => {
        if (error && attempt % 3 === 0) {
          console.log(
            `… retrying grep case-sensitive check (attempt ${attempt}): ${error.message ?? error}`
          );
        }
      },
    }
  );

  const grepCaseInsensitive = await waitFor(
    async () => {
      const result = await repo.grep({
        ref: defaultBranch,
        query: { pattern: 'onlyuppercase', caseSensitive: false },
        limits: { maxLines: 10 },
      });

      const hasMatch = result.matches.some((match) =>
        match.lines.some(
          (line) => line.type === 'match' && line.text.includes('ONLYUPPERCASE')
        )
      );
      return hasMatch ? result : null;
    },
    {
      timeout,
      description: 'grep API to return results for case-insensitive match',
      isFatalError: (error) =>
        error instanceof TypeError ||
        (error?.name === 'ApiError' &&
          typeof error.status === 'number' &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429),
      onRetry: ({ attempt, error }) => {
        if (attempt % 5 !== 0) {
          return;
        }
        if (error) {
          console.log(
            `… waiting for grep results (attempt ${attempt}): ${error.message ?? error}`
          );
        } else {
          console.log(`… waiting for grep results (attempt ${attempt})`);
        }
      },
    }
  );
  console.log(
    `✓ Grep API returns case-insensitive matches (${grepCaseInsensitive.matches.length} file(s))`
  );

  const grepFiltered = await waitFor(
    async () => {
      const result = await repo.grep({
        ref: defaultBranch,
        query: { pattern: grepToken, caseSensitive: true },
        fileFilters: { includeGlobs: ['README.md'] },
        limits: { maxLines: 10, maxMatchesPerFile: 3 },
      });

      const hasToken = result.matches.some((match) =>
        match.lines.some(
          (line) => line.type === 'match' && line.text.includes(grepToken)
        )
      );
      return hasToken ? result : null;
    },
    {
      timeout,
      description: 'grep API to return matches filtered to README.md',
      isFatalError: (error) =>
        error instanceof TypeError ||
        (error?.name === 'ApiError' &&
          typeof error.status === 'number' &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429),
      onRetry: ({ attempt, error }) => {
        if (attempt % 5 !== 0) {
          return;
        }
        if (error) {
          console.log(
            `… waiting for grep file-filtered match (attempt ${attempt}): ${error.message ?? error}`
          );
        } else {
          console.log(
            `… waiting for grep file-filtered match (attempt ${attempt})`
          );
        }
      },
    }
  );
  console.log(
    `✓ Grep API respects file filters (${grepFiltered.matches.length} file(s))`
  );

  const packSig = signature();
  const addMessage = 'Add file via commit-pack API (SDK)';
  const addCommit = await repo
    .createCommit({
      targetBranch: defaultBranch,
      expectedHeadSha: latestCommitSha,
      commitMessage: addMessage,
      author: packSig,
      committer: packSig,
    })
    .addFileFromString(
      'api-generated.txt',
      [
        'File generated via GitStorage SDK full workflow script.',
        `Repository: ${repoId}`,
        `Commit message: ${addMessage}`,
      ].join('\n'),
      { encoding: 'utf-8' }
    )
    .send();
  latestCommitSha = addCommit.commitSha;
  console.log(`✓ Commit-pack add executed (${latestCommitSha})`);

  await waitFor(
    async () => {
      const commits = await repo.listCommits({
        branch: defaultBranch,
        limit: 5,
      });
      const match = commits.commits.find(
        (commit) => commit.sha === latestCommitSha
      );
      if (match) {
        if (match.message !== addMessage) {
          throw new Error(`Unexpected commit message: ${match.message}`);
        }
        return match;
      }
      return null;
    },
    { timeout, description: 'commit-pack add to appear in commit list' }
  );
  console.log(`✓ Commit listing includes commit-pack add`);

  await waitFor(
    async () => {
      const branches = await repo.listBranches({ limit: 10 });
      return branches.branches.find(
        (branch) =>
          branch.name === defaultBranch && branch.headSha === latestCommitSha
      );
    },
    {
      timeout,
      description: `default branch ${defaultBranch} to advance to commit-pack add`,
    }
  );
  console.log(`✓ Default branch advanced to commit-pack add`);

  await waitFor(
    async () => {
      const files = await repo.listFiles({ ref: defaultBranch });
      return files.paths.includes('api-generated.txt') ? files : null;
    },
    {
      timeout,
      description: 'api-generated.txt to appear in listFiles response',
    }
  );
  console.log(`✓ api-generated.txt present via listFiles`);

  const updateSig = signature();
  const updateMessage = 'Update document via commit-pack API (SDK)';
  const updateCommit = await repo
    .createCommit({
      targetBranch: defaultBranch,
      expectedHeadSha: latestCommitSha,
      commitMessage: updateMessage,
      author: updateSig,
      committer: updateSig,
    })
    .addFileFromString(
      'api-generated.txt',
      [
        'File generated via GitStorage SDK full workflow script.',
        `Repository: ${repoId}`,
        'Updated content: CommitPack run verified document update via SDK.',
      ].join('\n'),
      { encoding: 'utf-8' }
    )
    .send();
  latestCommitSha = updateCommit.commitSha;
  console.log(`✓ Commit-pack update executed (${latestCommitSha})`);

  const updateInfo = await waitFor(
    async () => {
      const commits = await repo.listCommits({
        branch: defaultBranch,
        limit: 5,
      });
      return commits.commits.find((commit) => commit.sha === latestCommitSha);
    },
    { timeout, description: 'commit-pack update to appear in commit list' }
  );
  if (updateInfo.message !== updateMessage) {
    throw new Error(
      `Unexpected commit message for update: ${updateInfo.message}`
    );
  }
  console.log(`✓ Commit listing includes commit-pack update`);

  await waitFor(
    async () => {
      const branches = await repo.listBranches({ limit: 10 });
      return branches.branches.find(
        (branch) =>
          branch.name === defaultBranch && branch.headSha === latestCommitSha
      );
    },
    {
      timeout,
      description: `default branch ${defaultBranch} to advance to commit-pack update`,
    }
  );
  console.log(`✓ Default branch advanced to commit-pack update`);

  const diff = await waitFor(
    async () => {
      const response = await repo.getCommitDiff({ sha: latestCommitSha });
      return response.files.some((file) => file.path === 'api-generated.txt')
        ? response
        : null;
    },
    { timeout, description: 'commit diff for commit-pack update' }
  );
  console.log(`✓ Commit diff verified (${diff.files.length} file(s))`);

  await waitFor(
    async () => {
      const response = await repo.getFileStream({
        path: 'api-generated.txt',
        ref: defaultBranch,
      });
      const body = await response.text();
      return body.includes('Updated content') ? body : null;
    },
    { timeout, description: 'api-generated.txt to return updated content' }
  );
  console.log(`✓ api-generated.txt contains updated content`);

  const diffSig = signature();
  const diffMessage = 'Apply diff via createCommitFromDiff (SDK)';
  const diffFileName = 'diff-endpoint.txt';
  const diffLines = [
    'Diff commit created by GitStorage SDK full workflow script.',
    `Repository: ${repoId}`,
    `Timestamp: ${new Date().toISOString()}`,
  ];
  const diffBody = `${diffLines.join('\n')}\n`;
  const diffBlobSha = gitBlobSha(diffBody);
  const diffHunkHeader = `@@ -0,0 +1,${diffLines.length} @@`;
  const diffPatchLines = [
    `diff --git a/${diffFileName} b/${diffFileName}`,
    'new file mode 100644',
    `index 0000000000000000000000000000000000000000..${diffBlobSha}`,
    '--- /dev/null',
    `+++ b/${diffFileName}`,
    diffHunkHeader,
    ...diffLines.map((line) => `+${line}`),
  ];
  const diffPatch = `${diffPatchLines.join('\n')}\n`;

  const diffCommit = await repo.createCommitFromDiff({
    targetBranch: defaultBranch,
    expectedHeadSha: latestCommitSha,
    commitMessage: diffMessage,
    author: diffSig,
    committer: diffSig,
    diff: diffPatch,
  });
  latestCommitSha = diffCommit.commitSha;
  console.log(`✓ createCommitFromDiff commit executed (${latestCommitSha})`);

  const diffCommitInfo = await waitFor(
    async () => {
      const commits = await repo.listCommits({
        branch: defaultBranch,
        limit: 5,
      });
      return commits.commits.find((commit) => commit.sha === latestCommitSha);
    },
    { timeout, description: 'diff commit to appear in commit list' }
  );
  if (diffCommitInfo.message !== diffMessage) {
    throw new Error(
      `Unexpected diff commit message: ${diffCommitInfo.message}`
    );
  }
  console.log('✓ Commit listing includes createCommitFromDiff commit');

  await waitFor(
    async () => {
      const files = await repo.listFiles({ ref: defaultBranch });
      return files.paths.includes(diffFileName) ? files : null;
    },
    { timeout, description: `${diffFileName} to appear in listFiles response` }
  );
  console.log(`✓ ${diffFileName} present via listFiles`);

  await waitFor(
    async () => {
      const response = await repo.getFileStream({
        path: diffFileName,
        ref: defaultBranch,
      });
      const body = await response.text();
      return body.includes('Diff commit created') ? body : null;
    },
    { timeout, description: `${diffFileName} to contain diff-applied content` }
  );
  console.log(`✓ ${diffFileName} contains diff-applied content`);

  const featureBranch = `sdk-feature-${Date.now()}`;
  const featureSig = signature();
  const featureMessage = 'Create feature branch via commit-pack API (SDK)';
  const featureOptions = {
    targetBranch: featureBranch,
    baseBranch: defaultBranch,
    expectedHeadSha: latestCommitSha,
    commitMessage: featureMessage,
    author: featureSig,
    committer: featureSig,
  };
  console.log('[full-workflow] feature commit options', featureOptions);
  const featureCommit = await repo
    .createCommit(featureOptions)
    .addFileFromString(
      'feature.txt',
      [
        'Feature branch file generated via GitStorage SDK full workflow script.',
        `Repository: ${repoId}`,
        `Branch: ${featureBranch}`,
      ].join('\n')
    )
    .send();
  console.log(`✓ Feature branch commit created (${featureCommit.commitSha})`);

  await waitFor(
    async () => {
      const branches = await repo.listBranches({ limit: 25 });
      return branches.branches.find(
        (branch) =>
          branch.name === featureBranch &&
          branch.headSha === featureCommit.commitSha
      );
    },
    {
      timeout,
      description: `feature branch ${featureBranch} to appear in branch list`,
    }
  );
  console.log(`✓ Feature branch ${featureBranch} reported by listBranches`);

  await waitFor(
    async () => {
      const files = await repo.listFiles({ ref: featureBranch });
      return files.paths.includes('feature.txt') ? files : null;
    },
    { timeout, description: 'feature branch file to be accessible' }
  );
  console.log(`✓ feature.txt accessible on ${featureBranch}`);

  const restoreSig = signature();
  const restoreMessage = `Restore to pre-deploy baseline`;
  const restoreResult = await repo.restoreCommit({
    targetBranch: defaultBranch,
    expectedHeadSha: latestCommitSha,
    targetCommitSha: baselineCommitSha,
    commitMessage: restoreMessage,
    author: restoreSig,
    committer: restoreSig,
  });
  latestCommitSha = restoreResult.commitSha;
  console.log(`✓ Restore commit executed (${latestCommitSha})`);

  const restoreInfo = await waitFor(
    async () => {
      const commits = await repo.listCommits({
        branch: defaultBranch,
        limit: 5,
      });
      return commits.commits.find((commit) => commit.sha === latestCommitSha);
    },
    { timeout, description: 'restore commit to appear in commit list' }
  );
  if (restoreInfo.message !== restoreMessage) {
    throw new Error(
      `Unexpected restore commit message: ${restoreInfo.message}`
    );
  }

  await waitFor(
    async () => {
      const branches = await repo.listBranches({ limit: 10 });
      return branches.branches.find(
        (branch) =>
          branch.name === defaultBranch && branch.headSha === latestCommitSha
      );
    },
    {
      timeout,
      description: `default branch ${defaultBranch} to advance to restore commit`,
    }
  );
  console.log(`✓ Default branch advanced to restore commit`);

  await waitFor(
    async () => {
      const files = await repo.listFiles({ ref: defaultBranch });
      return files.paths.some(
        (path) => path === 'api-generated.txt' || path === diffFileName
      )
        ? null
        : files;
    },
    {
      timeout,
      description:
        'api-generated.txt and diff-endpoint.txt removed after restore commit',
    }
  );
  console.log(
    `✓ api-generated.txt and ${diffFileName} removed by restore commit`
  );

  const readmeBody = await repo
    .getFileStream({ path: 'README.md', ref: defaultBranch })
    .then((resp) => resp.text());
  if (!readmeBody.includes(repoId)) {
    throw new Error('README does not contain repository identifier');
  }
  console.log(`✓ README accessible via getFileStream`);

  console.log('\n✅ GitStorage SDK full workflow completed successfully.');
  console.log(`   Repository: ${repoId}`);
  console.log(`   Default branch: ${defaultBranch}`);
}

function patchGitStorage(GitStorage) {
  if (GitStorage.prototype.__fullWorkflowPatched) {
    return;
  }

  GitStorage.prototype.__fullWorkflowPatched = true;

  GitStorage.prototype.generateJWT = async function patchedGenerateJWT(
    repoId,
    options
  ) {
    const permissions = options?.permissions || ['git:write', 'git:read'];
    const ttl = options?.ttl || 365 * 24 * 60 * 60;
    const now = Math.floor(Date.now() / 1_000);
    const payload = {
      iss: this.options.name,
      sub: '@pierre/storage',
      repo: repoId,
      scopes: permissions,
      iat: now,
      exp: now + ttl,
    };

    const { key, alg } = await resolveSigningKey(this.options.key);
    const header = { alg, typ: 'JWT' };
    if (env.keyId) {
      header.kid = env.keyId;
    }

    return new SignJWT(payload).setProtectedHeader(header).sign(key);
  };
}

async function resolveSigningKey(pem) {
  if (KEY_CACHE.has(pem)) {
    return KEY_CACHE.get(pem);
  }

  let selectedAlgorithm;

  try {
    const keyObject = createPrivateKey({ key: pem, format: 'pem' });
    const type = keyObject.asymmetricKeyType;
    if (type === 'rsa') {
      selectedAlgorithm = 'RS256';
    } else if (type === 'rsa-pss') {
      selectedAlgorithm = 'PS256';
    } else if (type === 'ec') {
      const curve = keyObject.asymmetricKeyDetails?.namedCurve?.toLowerCase();
      switch (curve) {
        case 'prime256v1':
        case 'secp256r1':
        case 'p-256':
          selectedAlgorithm = 'ES256';
          break;
        case 'secp384r1':
        case 'p-384':
          selectedAlgorithm = 'ES384';
          break;
        case 'secp521r1':
        case 'p-521':
          selectedAlgorithm = 'ES512';
          break;
        default:
          break;
      }
    } else if (type === 'ed25519' || type === 'ed448') {
      selectedAlgorithm = 'EdDSA';
    }
    // fallthrough to general detection if selectedAlgorithm remains undefined
  } catch {
    // Ignore inspection errors, fall back to brute-force detection below.
  }

  if (selectedAlgorithm) {
    try {
      const key = await importPKCS8(pem, selectedAlgorithm);
      const entry = { key, alg: selectedAlgorithm };
      KEY_CACHE.set(pem, entry);
      return entry;
    } catch {
      // If the direct attempt fails, continue with the fallback list below.
    }
  }

  const algorithms = [
    'RS256',
    'RS384',
    'RS512',
    'PS256',
    'PS384',
    'PS512',
    'ES256',
    'ES384',
    'ES512',
    'EdDSA',
  ];
  let lastError;

  for (const alg of algorithms) {
    try {
      const key = await importPKCS8(pem, alg);
      const entry = { key, alg };
      KEY_CACHE.set(pem, entry);
      return entry;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error('Unsupported key type for JWT signing', { cause: lastError });
}

main().catch((error) => {
  console.error('❌ Workflow failed.');
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error
  );
  process.exitCode = 1;
});
