import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['api/src/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: true,
    alias: {
      // Resolve .js imports to .ts source for Vitest
      '../cosmos.js': new URL('api/src/cosmos.ts', import.meta.url).pathname,
      '../storage.js': new URL('api/src/storage.ts', import.meta.url).pathname,
      '../pubsub.js': new URL('api/src/pubsub.ts', import.meta.url).pathname,
      '../auth.js': new URL('api/src/auth.ts', import.meta.url).pathname,
      '../validation.js': new URL('api/src/validation.ts', import.meta.url).pathname,
      '../index.js': new URL('api/src/index.ts', import.meta.url).pathname,
    },
  },
});
