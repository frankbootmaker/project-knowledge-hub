import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import { createDatabase, users } from '@project-knowledge-hub/database';
import { resolveOidcUser } from './oidc-users.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('resolveOidcUser', () => {
  let closeDatabase: (() => Promise<void>) | undefined;
  let database: ReturnType<typeof createDatabase>;
  const password = 'Test-password-123';
  const idpSource = 'authentik';

  beforeAll(() => {
    const env = loadEnv({
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'test',
      LOG_LEVEL: 'silent',
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    });
    database = createDatabase(env.DATABASE_URL);
    closeDatabase = () => database.close();
  });

  afterAll(async () => {
    await closeDatabase?.();
  });

  it('matches by idp subject', async () => {
    const suffix = randomUUID();
    const subject = `sub-${suffix}`;
    const [user] = await database.db
      .insert(users)
      .values({
        email: `oidc-sub-${suffix}@example.com`,
        displayName: 'OIDC Sub',
        passwordHash: await hashPassword(password),
        status: 'active',
        idpSource,
        idpSubject: subject,
      })
      .returning();
    expect(user).toBeTruthy();

    const result = await resolveOidcUser(database, {
      idpSource,
      subject,
      email: user!.email,
      emailVerified: true,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.user.id).toBe(user!.id);
      expect(result.linked).toBe(false);
      expect(result.created).toBe(false);
    }
  });

  it('links active user by verified email when IdP fields empty', async () => {
    const suffix = randomUUID();
    const email = `oidc-link-${suffix}@example.com`;
    const [user] = await database.db
      .insert(users)
      .values({
        email,
        displayName: 'OIDC Link',
        passwordHash: await hashPassword(password),
        status: 'active',
      })
      .returning();
    expect(user).toBeTruthy();

    const subject = `link-sub-${suffix}`;
    const result = await resolveOidcUser(database, {
      idpSource,
      subject,
      email,
      emailVerified: true,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.linked).toBe(true);
      expect(result.created).toBe(false);
      expect(result.user.idpSource).toBe(idpSource);
      expect(result.user.idpSubject).toBe(subject);
    }
  });

  it('rejects unknown email and unverified email link', async () => {
    const unknown = await resolveOidcUser(database, {
      idpSource,
      subject: `missing-${randomUUID()}`,
      email: `nobody-${randomUUID()}@example.com`,
      emailVerified: true,
    });
    expect(unknown.status).toBe('unknown');

    const suffix = randomUUID();
    const email = `oidc-unverif-${suffix}@example.com`;
    await database.db.insert(users).values({
      email,
      displayName: 'Unverified',
      passwordHash: await hashPassword(password),
      status: 'active',
    });
    const unverified = await resolveOidcUser(database, {
      idpSource,
      subject: `unverif-${suffix}`,
      email,
      emailVerified: false,
    });
    expect(unverified.status).toBe('unknown');
  });

  it('rejects inactive users', async () => {
    const suffix = randomUUID();
    const subject = `inactive-${suffix}`;
    const [user] = await database.db
      .insert(users)
      .values({
        email: `oidc-inactive-${suffix}@example.com`,
        displayName: 'Inactive',
        passwordHash: await hashPassword(password),
        status: 'pending_approval',
        idpSource,
        idpSubject: subject,
      })
      .returning();
    expect(user).toBeTruthy();

    const result = await resolveOidcUser(database, {
      idpSource,
      subject,
      email: user!.email,
      emailVerified: true,
    });
    expect(result.status).toBe('inactive');
  });

  it('rejects email already linked to another subject', async () => {
    const suffix = randomUUID();
    const email = `oidc-conflict-${suffix}@example.com`;
    await database.db.insert(users).values({
      email,
      displayName: 'Conflict',
      passwordHash: await hashPassword(password),
      status: 'active',
      idpSource,
      idpSubject: `other-${suffix}`,
    });

    const result = await resolveOidcUser(database, {
      idpSource,
      subject: `new-${suffix}`,
      email,
      emailVerified: true,
    });
    expect(result.status).toBe('conflict');
  });

  it('creates an active user when JIT is enabled and email is verified', async () => {
    const suffix = randomUUID();
    const email = `oidc-jit-${suffix}@example.com`;
    const subject = `jit-sub-${suffix}`;
    const result = await resolveOidcUser(database, {
      idpSource,
      subject,
      email,
      emailVerified: true,
      displayName: 'JIT User',
      jitProvisioning: true,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.created).toBe(true);
      expect(result.linked).toBe(false);
      expect(result.user.email).toBe(email);
      expect(result.user.displayName).toBe('JIT User');
      expect(result.user.status).toBe('active');
      expect(result.user.passwordHash).toBeNull();
      expect(result.user.idpSource).toBe(idpSource);
      expect(result.user.idpSubject).toBe(subject);
    }
  });

  it('does not JIT-create when flag is off or email is unverified', async () => {
    const suffix = randomUUID();
    const off = await resolveOidcUser(database, {
      idpSource,
      subject: `jit-off-${suffix}`,
      email: `oidc-jit-off-${suffix}@example.com`,
      emailVerified: true,
      jitProvisioning: false,
    });
    expect(off.status).toBe('unknown');

    const unverified = await resolveOidcUser(database, {
      idpSource,
      subject: `jit-unverif-${suffix}`,
      email: `oidc-jit-unverif-${suffix}@example.com`,
      emailVerified: false,
      jitProvisioning: true,
    });
    expect(unverified.status).toBe('unknown');
  });

  it('uses email local-part when JIT displayName claim is missing', async () => {
    const suffix = randomUUID();
    const email = `oidc-local-${suffix}@example.com`;
    const result = await resolveOidcUser(database, {
      idpSource,
      subject: `jit-local-${suffix}`,
      email,
      emailVerified: true,
      jitProvisioning: true,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.created).toBe(true);
      expect(result.user.displayName).toBe(`oidc-local-${suffix}`);
    }
  });
});
