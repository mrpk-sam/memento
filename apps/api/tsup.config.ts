import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts', 'src/db/seed.ts', 'src/lib/check-storage.ts', 'src/lib/check-email.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  // Bundle the workspace package; keep real npm deps external.
  noExternal: ['@memento/shared'],
});
