import { describe, expect, it } from 'vitest';
import { loadEnv } from './index.js';

describe('loadEnv', () => {
  it('parses required configuration', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      APP_ENV: 'test',
      WEB_PORT: '3100',
      API_PORT: '3101',
      WEB_URL: 'http://localhost:3100',
      API_URL: 'http://localhost:3101',
      DATABASE_URL: 'postgres://knowledge_hub:knowledge_hub@127.0.0.1:5432/knowledge_hub',
      REDIS_URL: 'redis://127.0.0.1:6379',
      LOG_LEVEL: 'info',
      SESSION_SECRET: 'test-session-secret-at-least-32-chars',
    });

    expect(env.WEB_PORT).toBe(3100);
    expect(env.API_PORT).toBe(3101);
    expect(env.SESSION_COOKIE_NAME).toBe('kh_session');
    expect(env.MAIL_DRIVER).toBe('console');
    expect(env.AUTH_PASSWORD_RESET_TTL_SECONDS).toBe(3600);
  });

  it('rejects missing database url', () => {
    expect(() =>
      loadEnv({
        WEB_URL: 'http://localhost:3100',
        API_URL: 'http://localhost:3101',
        REDIS_URL: 'redis://127.0.0.1:6379',
        SESSION_SECRET: 'test-session-secret-at-least-32-chars',
      }),
    ).toThrow(/Invalid environment configuration/);
  });
});
