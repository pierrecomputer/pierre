# solid-diff-demo

A minimal SolidJS app running with Bun's built-in server and bundler.

## Installation

```bash
bun install
```

## Running the App

Development mode (with file watching and auto-rebuild):

```bash
bun run dev
```

Production mode:

```bash
bun start
```

The app will be available at http://localhost:3000

## How It Works

- **SolidJS 1.9.10** - Reactive UI framework
- **bun-plugin-solid** - Bun plugin that uses Babel to transform SolidJS JSX
- **Bun.serve()** - Built-in HTTP server
- **Bun.build()** - Bundles the app on startup and watches for changes in dev mode
- No external bundler or build tools needed beyond what Bun provides

## Project Structure

```
.
├── src/
│   └── app.tsx       # SolidJS app entry point
├── index.html        # HTML template
├── index.ts          # Server + build script
└── dist/             # Built output (generated)
    └── app.js
```

## Note on SolidJS + Bun

Bun's native SolidJS JSX support is still incomplete, so this setup uses `bun-plugin-solid` which leverages `babel-preset-solid` under the hood for proper JSX transformation. This is currently the recommended approach for using SolidJS with Bun.
