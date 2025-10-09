'use client';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Check, ChevronsUpDown, GitBranch, Lock, Unlock } from 'lucide-react';
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

interface RepositoryDropdownProps {
  onRepositorySelect?: (repo: Repository | null) => void;
}

export function RepositoryDropdown({
  onRepositorySelect,
}: RepositoryDropdownProps) {
  const [open, setOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [repositories, setRepositories] = useState<InstallationRepos[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      // Handle the response - it returns { repositories: [...] }
      if (data.repositories) {
        // Convert flat array to grouped format expected by component
        const grouped: InstallationRepos[] = [
          {
            installation: {
              id: 0,
              account: 'Your Repositories',
              type: 'User',
            },
            repositories: data.repositories,
          },
        ];
        setRepositories(grouped);
      } else {
        setRepositories([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (repo: Repository) => {
    setSelectedRepo(repo);
    setOpen(false);
    onRepositorySelect?.(repo);
  };

  // Flatten all repositories for easier display
  const allRepos = repositories.flatMap((installation) =>
    installation.repositories.map((repo) => ({
      ...repo,
      account: installation.installation.account,
    }))
  );

  if (loading) {
    return (
      <Button variant="outline" disabled className="w-full justify-between">
        <span>Loading repositories...</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <Button variant="outline" disabled className="w-full justify-between">
          <span className="text-red-500">Error loading repositories</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
        <Button
          onClick={fetchRepositories}
          variant="outline"
          size="sm"
          className="w-full"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (allRepos.length === 0) {
    return (
      <Button variant="outline" disabled className="w-full justify-between">
        <span>No repositories available</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selectedRepo ? (
            <div className="flex items-center gap-2 truncate">
              <GitBranch className="h-4 w-4 shrink-0" />
              <span className="truncate">{selectedRepo.full_name}</span>
              {selectedRepo.private ? (
                <Lock className="h-3 w-3 shrink-0 text-gray-500" />
              ) : (
                <Unlock className="h-3 w-3 shrink-0 text-gray-500" />
              )}
            </div>
          ) : (
            <span>Select a repository...</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
        <div className="max-h-[400px] overflow-y-auto">
          {repositories.map((installation) => (
            <div key={installation.installation.id}>
              <div className="px-3 py-2 text-sm font-semibold text-gray-500 bg-gray-50 sticky top-0">
                {installation.installation.account}
              </div>
              {installation.repositories.map((repo) => (
                <button
                  key={repo.id}
                  onClick={() => handleSelect(repo)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100 transition-colors flex items-center gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 shrink-0 text-gray-400" />
                      <span className="font-medium truncate">{repo.name}</span>
                      {repo.private ? (
                        <Lock className="h-3 w-3 shrink-0 text-gray-500" />
                      ) : (
                        <Unlock className="h-3 w-3 shrink-0 text-gray-500" />
                      )}
                    </div>
                    {repo.description && (
                      <p className="text-xs text-gray-500 truncate mt-1">
                        {repo.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                      {repo.language && <span>{repo.language}</span>}
                      <span>⭐ {repo.stargazers_count || 0}</span>
                    </div>
                  </div>
                  {selectedRepo?.id === repo.id && (
                    <Check className="h-4 w-4 shrink-0 text-green-600" />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
