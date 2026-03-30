import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts']
    },
    // Increased timeouts for embedding model warmup in CI/test environments
    testTimeout: 60000,
    hookTimeout: 120000
  },
  resolve: {
    alias: {
      '@god-agent': resolve(__dirname, './src/god-agent'),
      '@tests': resolve(__dirname, './tests')
    }
  }
});
