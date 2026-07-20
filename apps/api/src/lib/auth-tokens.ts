import { and, eq, isNull } from 'drizzle-orm';
import {
  createAuthToken,
  hashAuthToken,
  hashPassword,
} from '@project-knowledge-hub/auth';
import {
  authTokens,
  users,
  type Database,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';

export type AuthTokenPurpose = 'password_reset' | 'invite' | 'email_confirm';

export async function issueAuthToken(
  database: Database,
  input: {
    userId: string;
    purpose: AuthTokenPurpose;
    ttlSeconds: number;
  },
): Promise<string> {
  const rawToken = createAuthToken();
  const tokenHash = hashAuthToken(rawToken);
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);

  await database.db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, input.userId),
        eq(authTokens.purpose, input.purpose),
        isNull(authTokens.usedAt),
      ),
    );

  await database.db.insert(authTokens).values({
    userId: input.userId,
    purpose: input.purpose,
    tokenHash,
    expiresAt,
  });

  return rawToken;
}

export type AuthTokenPreviewStatus = 'valid' | 'expired' | 'used' | 'invalid';

export async function previewAuthToken(
  database: Database,
  rawToken: string,
): Promise<{
  status: AuthTokenPreviewStatus;
  purpose?: AuthTokenPurpose;
  email?: string;
}> {
  if (!rawToken.trim()) {
    return { status: 'invalid' };
  }

  const tokenHash = hashAuthToken(rawToken);
  const [row] = await database.db
    .select({
      purpose: authTokens.purpose,
      expiresAt: authTokens.expiresAt,
      usedAt: authTokens.usedAt,
      email: users.email,
    })
    .from(authTokens)
    .innerJoin(users, eq(users.id, authTokens.userId))
    .where(eq(authTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row) {
    return { status: 'invalid' };
  }

  if (row.usedAt) {
    return {
      status: 'used',
      purpose: row.purpose as AuthTokenPurpose,
      email: row.email,
    };
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    return {
      status: 'expired',
      purpose: row.purpose as AuthTokenPurpose,
      email: row.email,
    };
  }

  return {
    status: 'valid',
    purpose: row.purpose as AuthTokenPurpose,
    email: row.email,
  };
}

export async function consumeAuthTokenAndSetPassword(
  database: Database,
  input: { rawToken: string; password: string },
): Promise<{ userId: string; purpose: AuthTokenPurpose }> {
  const tokenHash = hashAuthToken(input.rawToken);
  const [row] = await database.db
    .select()
    .from(authTokens)
    .where(eq(authTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.usedAt) {
    throw new AppError({
      code: 'AUTH_TOKEN_INVALID',
      message: 'This link is invalid or has already been used',
      statusCode: 400,
    });
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    throw new AppError({
      code: 'AUTH_TOKEN_EXPIRED',
      message: 'This link has expired',
      statusCode: 400,
    });
  }

  const purpose = row.purpose as AuthTokenPurpose;
  if (purpose !== 'password_reset' && purpose !== 'invite') {
    throw new AppError({
      code: 'AUTH_TOKEN_INVALID',
      message: 'This link is invalid or has already been used',
      statusCode: 400,
    });
  }

  const [user] = await database.db
    .select()
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);

  if (!user || user.status === 'disabled') {
    throw new AppError({
      code: 'AUTH_TOKEN_INVALID',
      message: 'This link is invalid or has already been used',
      statusCode: 400,
    });
  }

  const passwordHash = await hashPassword(input.password);
  const nextStatus = user.status === 'invited' ? 'active' : user.status;

  await database.db
    .update(users)
    .set({
      passwordHash,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await database.db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(eq(authTokens.id, row.id));

  await database.db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, user.id),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.usedAt),
      ),
    );

  return { userId: user.id, purpose };
}

export async function consumeEmailConfirmToken(
  database: Database,
  rawToken: string,
): Promise<{ userId: string; email: string }> {
  const tokenHash = hashAuthToken(rawToken);
  const [row] = await database.db
    .select()
    .from(authTokens)
    .where(eq(authTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.usedAt) {
    throw new AppError({
      code: 'AUTH_TOKEN_INVALID',
      message: 'This link is invalid or has already been used',
      statusCode: 400,
    });
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    throw new AppError({
      code: 'AUTH_TOKEN_EXPIRED',
      message: 'This link has expired',
      statusCode: 400,
    });
  }

  if (row.purpose !== 'email_confirm') {
    throw new AppError({
      code: 'AUTH_TOKEN_INVALID',
      message: 'This link is invalid or has already been used',
      statusCode: 400,
    });
  }

  const [user] = await database.db
    .select()
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);

  if (!user || user.status !== 'pending_email') {
    throw new AppError({
      code: 'AUTH_TOKEN_INVALID',
      message: 'This link is invalid or has already been used',
      statusCode: 400,
    });
  }

  await database.db
    .update(users)
    .set({
      status: 'pending_approval',
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await database.db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(eq(authTokens.id, row.id));

  await database.db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, user.id),
        eq(authTokens.purpose, 'email_confirm'),
        isNull(authTokens.usedAt),
      ),
    );

  return { userId: user.id, email: user.email };
}
