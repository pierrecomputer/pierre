import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';

// Environment variables (you'll need to add these to your .env.local)
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY;
// const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
// const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY) {
  console.warn(
    'GitHub App environment variables not configured. Some features may not work.'
  );
}

// Create GitHub App instance (only if credentials are available)
export const githubApp =
  GITHUB_APP_ID && GITHUB_APP_PRIVATE_KEY
    ? new App({
        appId: GITHUB_APP_ID,
        privateKey: GITHUB_APP_PRIVATE_KEY,
      })
    : null;

// Get installation URL for GitHub App
export function getInstallationUrl(redirectUrl?: string) {
  const baseUrl = `https://github.com/apps/${process.env.GITHUB_APP_SLUG || 'your-app-name'}/installations/new`;

  if (redirectUrl) {
    return `${baseUrl}?state=${encodeURIComponent(redirectUrl)}`;
  }

  return baseUrl;
}

// Get Octokit instance for a specific installation
export async function getOctokitForInstallation(installationId: number) {
  if (!githubApp) {
    throw new Error('GitHub App not configured');
  }
  const octokit = await githubApp.getInstallationOctokit(installationId);
  return octokit;
}

// Alias for getOctokitForInstallation for backward compatibility
export const getInstallationClient = getOctokitForInstallation;

// Get all installations for the app
export async function getInstallations() {
  if (!githubApp || !GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY) {
    console.warn('GitHub App not configured, returning empty installations');
    return [];
  }

  try {
    // Create a new Octokit instance with app auth
    const { createAppAuth } = await import('@octokit/auth-app');

    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: GITHUB_APP_ID,
        privateKey: GITHUB_APP_PRIVATE_KEY,
      },
    });

    const { data: installations } = await octokit.request(
      'GET /app/installations'
    );
    return installations;
  } catch (error) {
    console.error('Error fetching installations:', error);
    return [];
  }
}

// Verify installation and get details
export async function getInstallation(installationId: number) {
  try {
    const octokit = await getOctokitForInstallation(installationId);
    const { data: installation } = await octokit.request(
      'GET /app/installations/{installation_id}',
      {
        installation_id: installationId,
      }
    );
    return installation;
  } catch (error) {
    console.error('Error getting installation:', error);
    return null;
  }
}

// Get repositories accessible by a specific installation
export async function getInstallationRepositories(installationId: number) {
  try {
    const octokit = await getOctokitForInstallation(installationId);
    const { data } = await octokit.request('GET /installation/repositories', {
      per_page: 100,
    });
    return data.repositories;
  } catch (error) {
    console.error('Error getting installation repositories:', error);
    return [];
  }
}

// Get all repositories from all installations
export async function getAllRepositories() {
  try {
    const installations = await getInstallations();
    const allRepos = [];

    for (const installation of installations) {
      const repos = await getInstallationRepositories(installation.id);
      allRepos.push({
        installation: {
          id: installation.id,
          account: installation.account?.login,
          type: installation.account?.type,
        },
        repositories: repos,
      });
    }

    return allRepos;
  } catch (error) {
    console.error('Error getting all repositories:', error);
    return [];
  }
}
