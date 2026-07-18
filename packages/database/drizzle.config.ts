import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://knowledge_hub:knowledge_hub@127.0.0.1:5432/knowledge_hub',
  },
  strict: true,
  verbose: true,
});
