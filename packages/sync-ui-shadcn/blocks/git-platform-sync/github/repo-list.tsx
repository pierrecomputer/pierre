'use client';

import { Button } from '@/components/ui/button';
import { ExternalLink, GitBranch, Lock, Star, Unlock } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Repository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  default_branch: string;
  language: string | null;
  updated_at: string;
}

interface InstallationRepos {
  installation: {
    id: number;
    account: string;
    type: string;
  };
  repositories: Repository[];
}

export function RepositoryList() {
  const [repositories, setRepositories] = useState<InstallationRepos[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalRepos, setTotalRepos] = useState(0);

  useEffect(() => {
    fetchRepositories();
  }, []);

  const fetchRepositories = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/github/repositories');

      if (!response.ok) {
        throw new Error('Failed to fetch repositories');
      }

      const data = await response.json();
      setRepositories(data.data);
      setTotalRepos(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading repositories...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">Error: {error}</p>
        <Button onClick={fetchRepositories} variant="outline" className="mt-2">
          Retry
        </Button>
      </div>
    );
  }

  if (repositories.length === 0) {
    return (
      <div className="text-center p-8">
        <p className="text-gray-600">
          No repositories found. Please install the GitHub App on an
          organization first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Connected Repositories</h2>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            Total: {totalRepos}{' '}
            {totalRepos === 1 ? 'repository' : 'repositories'}
          </span>
          <Button onClick={fetchRepositories} variant="outline" size="sm">
            Refresh
          </Button>
        </div>
      </div>

      {repositories.map((installation) => (
        <div
          key={installation.installation.id}
          className="border rounded-lg p-4 space-y-4"
        >
          <div className="flex items-center justify-between pb-2 border-b">
            <h3 className="font-semibold text-lg">
              {installation.installation.account}
            </h3>
            <span className="text-sm text-gray-500 capitalize">
              {installation.installation.type}
            </span>
          </div>

          {installation.repositories.length === 0 ? (
            <p className="text-gray-500 text-sm">No repositories accessible</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {installation.repositories.map((repo) => (
                <div
                  key={repo.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <a
                          href={repo.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-600 hover:underline truncate flex items-center gap-1"
                        >
                          {repo.name}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        {repo.private ? (
                          <Lock className="h-4 w-4 text-gray-500" />
                        ) : (
                          <Unlock className="h-4 w-4 text-gray-500" />
                        )}
                      </div>

                      {repo.description && (
                        <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                          {repo.description}
                        </p>
                      )}

                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        {repo.language && (
                          <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                            {repo.language}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Star className="h-3 w-3" />
                          {repo.stargazers_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <GitBranch className="h-3 w-3" />
                          {repo.default_branch}
                        </span>
                      </div>

                      <div className="mt-2 text-xs text-gray-400">
                        Updated:{' '}
                        {new Date(repo.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
