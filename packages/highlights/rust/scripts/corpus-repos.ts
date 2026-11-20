// Fetch real source files for languages this machine has few or none of,
// from public repositories, into target/corpus-repos/<name>/. Each clone is
// shallow and sparse: only files matching the listed patterns download.
// scripts/parity-corpus.ts then reads them like any other root, applying
// each repository's extension overrides (MATLAB's `.m`, Angular's `.html`).
//
//   bun scripts/corpus-repos.ts        clone what is missing
//   bun scripts/corpus-repos.ts --list print the repositories
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface CorpusRepo {
  /** Directory name under target/corpus-repos/. */
  name: string;
  url: string;
  /** A tag or branch; the default branch when omitted. */
  ref?: string;
  /** Sparse-checkout patterns (gitignore syntax). */
  patterns: string[];
  /** Language for files with these extensions, overriding the alias table. */
  as?: Record<string, string>;
}

export const corpusRepos: CorpusRepo[] = [
  {
    name: 'okhttp',
    url: 'https://github.com/square/okhttp',
    patterns: ['*.kt', '*.kts'],
  },
  {
    name: 'exposed',
    url: 'https://github.com/JetBrains/Exposed',
    patterns: ['*.kt'],
  },
  {
    name: 'cats',
    url: 'https://github.com/typelevel/cats',
    patterns: ['*.scala', '*.sbt'],
  },
  {
    name: 'spock',
    url: 'https://github.com/spockframework/spock',
    patterns: ['*.groovy', '*.gradle'],
  },
  {
    name: 'elm-spa-example',
    url: 'https://github.com/rtfeldman/elm-spa-example',
    patterns: ['*.elm'],
  },
  { name: 'elm-core', url: 'https://github.com/elm/core', patterns: ['*.elm'] },
  {
    name: 'cowboy',
    url: 'https://github.com/ninenines/cowboy',
    patterns: ['*.erl', '*.hrl'],
  },
  {
    name: 'rebar3',
    url: 'https://github.com/erlang/rebar3',
    patterns: ['*.erl', '*.hrl'],
  },
  {
    name: 'giraffe',
    url: 'https://github.com/giraffe-fsharp/Giraffe',
    patterns: ['*.fs', '*.fsx', '*.fsi'],
  },
  {
    name: 'fsharpplus',
    url: 'https://github.com/fsprojects/FSharpPlus',
    patterns: ['*.fs', '*.fsx'],
  },
  {
    name: 'dune',
    url: 'https://github.com/ocaml/dune',
    patterns: ['*.ml', '*.mli'],
  },
  {
    name: 'aeson',
    url: 'https://github.com/haskell/aeson',
    patterns: ['*.hs'],
  },
  {
    name: 'postgrest',
    url: 'https://github.com/PostgREST/postgrest',
    patterns: ['*.hs'],
  },
  {
    name: 'clojure',
    url: 'https://github.com/clojure/clojure',
    patterns: ['*.clj', '*.cljc', '*.edn'],
  },
  { name: 'nim', url: 'https://github.com/nim-lang/Nim', patterns: ['*.nim'] },
  {
    name: 'chebfun',
    url: 'https://github.com/chebfun/chebfun',
    patterns: ['*.m'],
    as: { m: 'matlab' },
  },
  {
    name: 'terraform-aws-vpc',
    url: 'https://github.com/terraform-aws-modules/terraform-aws-vpc',
    patterns: ['*.tf', '*.tfvars', '*.hcl'],
  },
  {
    name: 'terraform-aws-eks',
    url: 'https://github.com/terraform-aws-modules/terraform-aws-eks',
    patterns: ['*.tf', '*.tfvars', '*.hcl'],
  },
  {
    name: 'graphql-codegen',
    url: 'https://github.com/dotansimha/graphql-code-generator',
    patterns: ['*.graphql', '*.gql'],
  },
  {
    name: 'dxc',
    url: 'https://github.com/microsoft/DirectXShaderCompiler',
    patterns: ['/tools/clang/test/CodeGenHLSL/**/*.hlsl'],
  },
  {
    name: 'godot-demos',
    url: 'https://github.com/godotengine/godot-demo-projects',
    patterns: ['*.gd', '*.gdshader', '*.gdshaderinc', '*.tres', '*.tscn'],
  },
  { name: 'c3c', url: 'https://github.com/c3lang/c3c', patterns: ['*.c3'] },
  {
    name: 'cuda-samples',
    url: 'https://github.com/NVIDIA/cuda-samples',
    patterns: ['*.cu', '*.cuh'],
  },
  {
    name: 'flutter-samples',
    url: 'https://github.com/flutter/samples',
    patterns: ['*.dart'],
  },
  {
    name: 'lapack',
    url: 'https://github.com/Reference-LAPACK/lapack',
    patterns: ['*.f', '*.f90'],
  },
  {
    name: 'gleam-stdlib',
    url: 'https://github.com/gleam-lang/stdlib',
    patterns: ['*.gleam'],
  },
  {
    name: 'julia',
    url: 'https://github.com/JuliaLang/julia',
    patterns: ['/base/**/*.jl'],
  },
  {
    name: 'awesome-cv',
    url: 'https://github.com/posquit0/Awesome-CV',
    patterns: ['*.tex'],
  },
  {
    name: 'latex2e',
    url: 'https://github.com/latex3/latex2e',
    patterns: ['*.tex'],
  },
  {
    name: 'castle-engine',
    url: 'https://github.com/castle-engine/castle-engine',
    patterns: ['/src/**/*.pas'],
  },
  {
    name: 'dplyr',
    url: 'https://github.com/tidyverse/dplyr',
    patterns: ['*.R'],
  },
  {
    name: 'ggplot2',
    url: 'https://github.com/tidyverse/ggplot2',
    patterns: ['*.R'],
  },
  {
    name: 'openzeppelin',
    url: 'https://github.com/OpenZeppelin/openzeppelin-contracts',
    patterns: ['*.sol'],
  },
  {
    name: 'webgpu-samples',
    url: 'https://github.com/webgpu/webgpu-samples',
    patterns: ['*.wgsl'],
  },
  { name: 'wgpu', url: 'https://github.com/gfx-rs/wgpu', patterns: ['*.wgsl'] },
  {
    name: 'newtonsoft-json',
    url: 'https://github.com/JamesNK/Newtonsoft.Json',
    patterns: ['*.cs'],
  },
  {
    name: 'element-plus',
    url: 'https://github.com/element-plus/element-plus',
    patterns: ['*.vue'],
  },
  {
    name: 'preact',
    url: 'https://github.com/preactjs/preact',
    patterns: ['*.jsx'],
  },
  {
    name: 'react',
    url: 'https://github.com/facebook/react',
    patterns: ['*.jsx'],
  },
  {
    name: 'less',
    url: 'https://github.com/less/less.js',
    patterns: ['*.less'],
  },
  {
    name: 'ant-design-4',
    url: 'https://github.com/ant-design/ant-design',
    ref: '4.24.16',
    patterns: ['*.less'],
  },
  {
    name: 'angular-components',
    url: 'https://github.com/angular/components',
    patterns: ['*.html'],
    as: { html: 'angular-html' },
  },
  {
    name: 'json5-tests',
    url: 'https://github.com/json5/json5-tests',
    patterns: ['*.json5'],
  },
  {
    name: 'bulma-0.9',
    url: 'https://github.com/jgthms/bulma',
    ref: '0.9.4',
    patterns: ['*.sass'],
  },
];

/** The directory holding the clones. */
export const corpusReposDir = new URL(
  '../target/corpus-repos/',
  import.meta.url
).pathname;

/** Run git, failing loudly. */
function git(args: string[], cwd?: string): void {
  const r = spawnSync('git', args, {
    cwd,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
}

if (import.meta.main) {
  if (process.argv.includes('--list')) {
    for (const r of corpusRepos)
      console.log(`${r.name}\t${r.url}\t${r.patterns.join(' ')}`);
    process.exit(0);
  }
  mkdirSync(corpusReposDir, { recursive: true });
  for (const repo of corpusRepos) {
    const dir = join(corpusReposDir, repo.name);
    if (existsSync(dir)) continue;
    console.log(`clone ${repo.url}${repo.ref ? ` @ ${repo.ref}` : ''}`);
    try {
      git([
        'clone',
        '--quiet',
        '--depth',
        '1',
        '--filter=blob:none',
        '--no-checkout',
        ...(repo.ref ? ['--branch', repo.ref] : []),
        repo.url,
        dir,
      ]);
      git(['sparse-checkout', 'set', '--no-cone', ...repo.patterns], dir);
      git(['checkout', '--quiet'], dir);
    } catch (e) {
      console.log(`  skipped: ${(e as Error).message}`);
    }
  }
}
