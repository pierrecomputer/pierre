import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    restoreMocks: true,
  },
  define: {
    __API_BASE_URL__: JSON.stringify('https://api.{{org}}.3p.pierre.rip'),
    __STORAGE_BASE_URL__: JSON.stringify('{{org}}.3p.pierre.rip'),
  },
});
