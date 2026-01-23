'use client';

import type { FileTreeOptions } from '@pierre/file-tree';
import { FileTree } from '@pierre/file-tree';
import { FileTree as FileTreeReact } from '@pierre/file-tree/react';
import { startTransition, useCallback, useMemo, useRef, useState } from 'react';

import { sharedDemoFileTreeOptions } from './demo-data';

interface ClientPageProps {
  preloadedFileTreeHtml: string;
}

export function ClientPage({ preloadedFileTreeHtml }: ClientPageProps) {
  const [flattenEmptyDirectories, setFlattenEmptyDirectories] = useState(
    sharedDemoFileTreeOptions.flattenEmptyDirectories ?? false
  );

  const fileTreeOptions = useMemo<FileTreeOptions>(
    () => ({
      ...sharedDemoFileTreeOptions,
      flattenEmptyDirectories,
    }),
    [flattenEmptyDirectories]
  );

  const handleToggleFlatten = () => {
    startTransition(() => {
      setFlattenEmptyDirectories((prev: boolean) => !prev);
    });
  };

  return (
    <div className="m-4">
      <h1 className="mb-4 text-2xl font-bold">File Tree Examples</h1>

      {/* Controls */}
      <div
        className="mb-6 rounded-sm border p-4"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h4 className="text-lg font-bold">Controls</h4>
        <div className="flex flex-row gap-2">
          <label
            htmlFor="flatten-empty-directories"
            className="flex cursor-pointer items-center gap-2 select-none"
          >
            <input
              type="checkbox"
              id="flatten-empty-directories"
              checked={flattenEmptyDirectories}
              className="cursor-pointer"
              onChange={handleToggleFlatten}
            />
            Flatten Empty Directories
          </label>
        </div>
      </div>

      {/* Examples Grid */}
      <div className="grid grid-cols-2 gap-6">
        <ExampleCard
          title="Vanilla (Client-Side Rendered)"
          description="FileTree instance created and rendered entirely on the client"
        >
          <VanillaClientRendered options={fileTreeOptions} />
        </ExampleCard>

        <ExampleCard
          title="Vanilla (Server-Side Rendered)"
          description="HTML prerendered on server, hydrated with FileTree instance on client"
        >
          <VanillaServerRendered
            options={fileTreeOptions}
            prerenderedHTML={preloadedFileTreeHtml}
          />
        </ExampleCard>

        <ExampleCard
          title="React (Client-Side Rendered)"
          description="React FileTree component rendered entirely on the client"
        >
          <ReactClientRendered options={fileTreeOptions} />
        </ExampleCard>

        <ExampleCard
          title="React (Server-Side Rendered)"
          description="React FileTree with prerendered HTML, hydrated on client"
        >
          <ReactServerRendered
            options={fileTreeOptions}
            prerenderedHTML={preloadedFileTreeHtml}
          />
        </ExampleCard>
      </div>
    </div>
  );
}

/**
 * Card wrapper for each example
 */
function ExampleCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-sm font-bold">{title}</h2>
      <p className="text-muted-foreground mb-2 text-xs">{description}</p>
      <div
        className="overflow-hidden rounded-md p-5"
        style={{
          boxShadow: '0 0 0 1px var(--color-border), 0 1px 3px #0000000d',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Vanilla FileTree - Client-Side Rendered
 * Uses ref callback to create and render FileTree instance on client mount
 */
function VanillaClientRendered({ options }: { options: FileTreeOptions }) {
  const instanceRef = useRef<FileTree | null>(null);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      // Clean up previous instance on options change
      if (instanceRef.current != null) {
        instanceRef.current.cleanUp();
        node.innerHTML = '';
      }

      const fileTree = new FileTree(options);
      fileTree.render({ containerWrapper: node });
      instanceRef.current = fileTree;

      return () => {
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options]
  );

  return <div ref={ref} />;
}

/**
 * Vanilla FileTree - Server-Side Rendered
 * Uses declarative shadow DOM to prerender HTML, then hydrates with FileTree instance
 */
function VanillaServerRendered({
  options,
  prerenderedHTML,
}: {
  options: FileTreeOptions;
  prerenderedHTML: string;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const hasHydratedRef = useRef(false);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (node == null) {
        return;
      }

      // The ref is on the <file-tree-container> custom element itself
      const fileTreeContainer = node;

      // Clean up previous instance on options change
      if (instanceRef.current != null) {
        instanceRef.current.cleanUp();
        // Clear the shadow root content for re-render
        const shadowRoot = fileTreeContainer.shadowRoot;
        if (shadowRoot !== null) {
          const treeElement = Array.from(shadowRoot.children).find(
            (child): child is HTMLElement =>
              child instanceof HTMLElement && child.dataset?.fileTreeId != null
          );
          treeElement?.replaceChildren();
        }
      }

      const fileTree = new FileTree(options);

      if (!hasHydratedRef.current) {
        // Initial mount - hydrate the prerendered HTML
        fileTree.hydrate({
          fileTreeContainer,
          prerenderedHTML,
        });
        hasHydratedRef.current = true;
      } else {
        // Options changed - re-render
        fileTree.render({ fileTreeContainer });
      }

      instanceRef.current = fileTree;

      return () => {
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options, prerenderedHTML]
  );

  return (
    <file-tree-container
      ref={ref}
      dangerouslySetInnerHTML={{
        __html: `<template shadowrootmode="open">${prerenderedHTML}</template>`,
      }}
      suppressHydrationWarning
    />
  );
}

/**
 * React FileTree - Client-Side Rendered
 * No prerendered HTML, renders entirely on client
 */
function ReactClientRendered({ options }: { options: FileTreeOptions }) {
  return <FileTreeReact options={options} />;
}

/**
 * React FileTree - Server-Side Rendered
 * Uses prerendered HTML for SSR, hydrates on client
 */
function ReactServerRendered({
  options,
  prerenderedHTML,
}: {
  options: FileTreeOptions;
  prerenderedHTML: string;
}) {
  return <FileTreeReact options={options} prerenderedHTML={prerenderedHTML} />;
}
