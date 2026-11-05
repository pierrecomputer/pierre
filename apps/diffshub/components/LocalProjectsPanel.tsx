'use client';

import { IconArrowRightShort } from '@pierre/icons';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from './Button';
import {
  getLocalViewerPath,
  LOCAL_PROJECTS_ENDPOINT,
  LOCAL_PRS_ENDPOINT,
  type LocalProjectSummary,
} from '@/lib/localSource';

interface LocalPullRequest {
  number: number;
  title: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  author: string;
  url: string;
  updatedAt: string;
}

interface ProjectSectionState {
  project: LocalProjectSummary;
  prs: LocalPullRequest[] | null;
  error: string | null;
}

interface LocalProjectsPanelProps {
  // On the standalone /local page, show a hint when no config file exists.
  // On the home page the panel renders nothing instead.
  showEmptyHint?: boolean;
}

async function readErrorOrJson(response: Response): Promise<never> {
  const text = await response.text();
  throw new Error(
    text.trim() !== '' ? text.trim() : `Request failed (${response.status}).`
  );
}

// Lists the projects from local-projects.json and, per project, its open PRs
// fetched through /api/local/prs (which runs `gh pr list` server-side). Each
// PR links into the local viewer route, which renders `gh pr diff` output.
export function LocalProjectsPanel({
  showEmptyHint = false,
}: LocalProjectsPanelProps) {
  const [projects, setProjects] = useState<LocalProjectSummary[] | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<string, ProjectSectionState>>(
    {}
  );

  const loadPrs = useCallback(async (project: LocalProjectSummary) => {
    setSections((prev) => ({
      ...prev,
      [project.id]: { project, prs: null, error: null },
    }));
    try {
      const response = await fetch(
        `${LOCAL_PRS_ENDPOINT}?project=${encodeURIComponent(project.id)}&state=open`
      );
      if (!response.ok) await readErrorOrJson(response);
      const data = (await response.json()) as { prs: LocalPullRequest[] };
      setSections((prev) => ({
        ...prev,
        [project.id]: { project, prs: data.prs, error: null },
      }));
    } catch (error) {
      setSections((prev) => ({
        ...prev,
        [project.id]: {
          project,
          prs: null,
          error: error instanceof Error ? error.message : 'Failed to list PRs',
        },
      }));
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(LOCAL_PROJECTS_ENDPOINT);
      if (!response.ok) await readErrorOrJson(response);
      const data = (await response.json()) as {
        projects: LocalProjectSummary[];
      };
      const list = data.projects ?? [];
      setProjects(list);
      setConfigError(null);
      for (const project of list) {
        void loadPrs(project);
      }
    } catch (error) {
      setProjects([]);
      setConfigError(
        error instanceof Error ? error.message : 'Failed to load local projects'
      );
    }
  }, [loadPrs]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- initial mount fetch; setState happens after the awaits
    void load();
  }, [load]);

  if (
    projects != null &&
    projects.length === 0 &&
    !showEmptyHint &&
    configError == null
  ) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-muted-foreground text-sm font-normal">
          Local projects
        </h3>
        {projects != null && projects.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void load()}
          >
            Refresh
          </Button>
        )}
      </div>
      {configError != null && (
        <p className="text-destructive text-sm text-pretty">{configError}</p>
      )}
      {projects != null &&
        projects.length === 0 &&
        showEmptyHint &&
        configError == null && (
          <p className="text-muted-foreground text-sm text-pretty">
            No <code>local-projects.json</code> found. Copy{' '}
            <code>local-projects.example.json</code> next to the app and list
            the repos you want to browse locally, or set{' '}
            <code>DIFFSHUB_LOCAL_CONFIG</code> to point at a config file.
          </p>
        )}
      {projects?.map((project) => {
        const section = sections[project.id];
        return (
          <div key={project.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-medium">
                {project.label}
                <span className="text-muted-foreground ml-2 font-mono text-xs font-normal">
                  {project.repo}
                </span>
              </h4>
              <Link
                href={getLocalViewerPath({
                  project: project.id,
                  target: { kind: 'worktree' },
                })}
                className="inline-link text-xs"
              >
                local changes
              </Link>
            </div>
            {section == null || section.prs == null ? (
              <p className="text-muted-foreground text-sm">
                {section?.error ?? 'Loading PRs…'}
              </p>
            ) : section.prs.length === 0 ? (
              <p className="text-muted-foreground text-sm">No open PRs.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {section.prs.map((pr) => (
                  <li key={pr.number} className="flex items-start gap-1">
                    <IconArrowRightShort className="mt-0.5 flex-shrink-0 opacity-50" />
                    <Link
                      href={getLocalViewerPath({
                        project: project.id,
                        target: { kind: 'pull', pr: String(pr.number) },
                      })}
                      className="inline-link min-w-0"
                    >
                      <span className="text-muted-foreground font-mono">
                        #{pr.number}
                      </span>{' '}
                      <span className="truncate">{pr.title}</span>
                      <span className="text-muted-foreground ml-1 font-mono text-xs">
                        {pr.headRefName}
                        {pr.isDraft ? ' (draft)' : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
