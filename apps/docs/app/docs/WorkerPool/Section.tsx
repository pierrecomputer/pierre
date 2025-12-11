import { preloadFile } from '@pierre/diffs/ssr';

import { ProseWrapper } from '../ProseWrapper';
import {
  WORKER_POOL_API_REFERENCE,
  WORKER_POOL_ARCHITECTURE_ASCII,
  WORKER_POOL_CACHING,
  WORKER_POOL_HELPER_ESBUILD,
  WORKER_POOL_HELPER_NEXTJS,
  WORKER_POOL_HELPER_STATIC,
  WORKER_POOL_HELPER_VANILLA,
  WORKER_POOL_HELPER_VITE,
  WORKER_POOL_HELPER_WEBPACK,
  WORKER_POOL_REACT_USAGE,
  WORKER_POOL_VANILLA_USAGE,
  WORKER_POOL_VSCODE_BLOB_URL,
  WORKER_POOL_VSCODE_CSP,
  WORKER_POOL_VSCODE_FACTORY,
  WORKER_POOL_VSCODE_GLOBAL,
  WORKER_POOL_VSCODE_INLINE_SCRIPT,
  WORKER_POOL_VSCODE_LOCAL_ROOTS,
  WORKER_POOL_VSCODE_WORKER_URI,
} from './constants';
import Content from './content.mdx';

export async function WorkerPoolSection() {
  const [
    helperVite,
    helperNextJS,
    vscodeLocalRoots,
    vscodeWorkerUri,
    vscodeInlineScript,
    vscodeCsp,
    vscodeGlobal,
    vscodeBlobUrl,
    vscodeFactory,
    helperWebpack,
    helperESBuild,
    helperStatic,
    helperVanilla,
    vanillaUsage,
    reactUsage,
    apiReference,
    cachingExample,
    architectureASCII,
  ] = await Promise.all([
    preloadFile(WORKER_POOL_HELPER_VITE),
    preloadFile(WORKER_POOL_HELPER_NEXTJS),
    preloadFile(WORKER_POOL_VSCODE_LOCAL_ROOTS),
    preloadFile(WORKER_POOL_VSCODE_WORKER_URI),
    preloadFile(WORKER_POOL_VSCODE_INLINE_SCRIPT),
    preloadFile(WORKER_POOL_VSCODE_CSP),
    preloadFile(WORKER_POOL_VSCODE_GLOBAL),
    preloadFile(WORKER_POOL_VSCODE_BLOB_URL),
    preloadFile(WORKER_POOL_VSCODE_FACTORY),
    preloadFile(WORKER_POOL_HELPER_WEBPACK),
    preloadFile(WORKER_POOL_HELPER_ESBUILD),
    preloadFile(WORKER_POOL_HELPER_STATIC),
    preloadFile(WORKER_POOL_HELPER_VANILLA),
    preloadFile(WORKER_POOL_VANILLA_USAGE),
    preloadFile(WORKER_POOL_REACT_USAGE),
    preloadFile(WORKER_POOL_API_REFERENCE),
    preloadFile(WORKER_POOL_CACHING),
    preloadFile(WORKER_POOL_ARCHITECTURE_ASCII),
  ]);

  return (
    <ProseWrapper>
      <Content
        helperVite={helperVite}
        helperNextJS={helperNextJS}
        vscodeLocalRoots={vscodeLocalRoots}
        vscodeWorkerUri={vscodeWorkerUri}
        vscodeInlineScript={vscodeInlineScript}
        vscodeCsp={vscodeCsp}
        vscodeGlobal={vscodeGlobal}
        vscodeBlobUrl={vscodeBlobUrl}
        vscodeFactory={vscodeFactory}
        helperWebpack={helperWebpack}
        helperESBuild={helperESBuild}
        helperStatic={helperStatic}
        helperVanilla={helperVanilla}
        vanillaUsage={vanillaUsage}
        reactUsage={reactUsage}
        apiReference={apiReference}
        cachingExample={cachingExample}
        architectureASCII={architectureASCII}
      />
    </ProseWrapper>
  );
}
