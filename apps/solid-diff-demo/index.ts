import { SolidPlugin } from 'bun-plugin-solid';
import { watch } from 'node:fs';

async function build() {
  console.log('Building...');
  const result = await Bun.build({
    entrypoints: ['./src/app.tsx'],
    outdir: './dist',
    plugins: [SolidPlugin()],
    minify: false,
    splitting: false,
    target: 'browser',
  });

  if (!result.success) {
    console.error('Build failed');
    for (const message of result.logs) {
      console.error(message);
    }
    return false;
  }
  console.log('Build complete');
  return true;
}

// Initial build
await build();

// Watch for changes in dev mode
if (process.env.NODE_ENV !== 'production') {
  watch('./src', { recursive: true }, (event, filename) => {
    console.log(`File changed: ${filename}`);
    void build();
  });
}

// Simple static file server
Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/') {
      return new Response(Bun.file('./index.html'), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url.pathname.startsWith('/dist/')) {
      return new Response(Bun.file('.' + url.pathname), {
        headers: { 'Content-Type': 'application/javascript' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log('Server running at http://localhost:3000');
