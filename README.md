# PierreJS R&D

Spinning up a small repo to experiment with various ideas and such for PierreJS.

## Dev

Technically you can use the package manager of your choice, but I setup the
project using [bun](https://bun.sh/) and all example commands assume bun.

```bash
# Seup Dependencies
bun install

# Development
bun run dev
```

## Publishing precision diffs

Note that publishing precision diffs is a bit artisinal. You need to update the exports to be
/dist/ before exporting, otherwise the package wont work.

Long term, im hoping we can use publishConfig to override this, but because we
rely on Bun for package managment, we currently don't have this functionality.

## Architectural Notes

This is just a basic-ass vite project, so most of what you'll probably want to
be messing with is in the `./src` directory. I've setup 2 routes within this
vite project, one for react related stuff and the other for raw vanilla js api.

From a high level, I've been architecting this project to run on raw JS and
manipulating raw dom nodes for rendering, the reason being because this becomes
portable to pretty much any other platform in the future and it's not uncommon
for code snippets/files to be quite large and we want to make performance a
priority from day one.

Another thing I've done for testing is putting all `pierrejs` style related code
into a `pierre-js` sup directory and created a typescript alias to roughly make
it feel like a module. There's probably better ways we could architect this
repo for development and testing, but this works nicely for now. It does mean
that auto imports aren't super great at detecting the alias, so you often have
to manipulate whatever is generated.

As of this writing there are two man classes for rendering code - `CodeRenderer`
and `DiffRenderer`.

### CodeRenderer

Will probably be renamed, but it's goal is taking a `ReadableStream<string>`
that can be used to render code being streamed using Shiki.

### DiffRenderer

The goal of this class is rendering out data parsed out from a patch file. It
doesn't support streaming at the moment (but may in the future... have to figure
out how that might work because it's non-trivial).

### Shared Stuff

I've architected some internal utilities for ensuring only one shared shiki
highlighter instance and in cases of streaming, that all updates are piped
through a shared requestAnimationFrame.
