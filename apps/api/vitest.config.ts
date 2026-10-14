import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'api', include: ['src/**/*.test.ts'], testTimeout: 30000 } });
