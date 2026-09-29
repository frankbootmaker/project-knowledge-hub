import { describe, expect, it } from 'vitest';
import type { users } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { toPublicUser } from './public-user.js';
import {
  activeHumanUserConditions,
  activeMemberConditions,
  assertUserMayUseWebSignIn,
  categoryChangeAuditMetadata,
  categoryChangeEffects,
  changeUserCategorySchema,
  createUserSchema,
  systemUserExclusionCondition,
  updateUserSchema,
  validateUserCategoryChange,
  webSignInBlockReason,
} from './user-category.js';

const HUMAN = {
  id: '11111111-1111-4111-8111-111111111111',
  userType: 'human',
  status: 'active',
  isSystemAdmin: false,
  passwordHash: 'hash',
};

const SYSTEM = {
  ...HUMAN,
  id: '22222222-2222-4222-8222-222222222222',
  userType: 'system',
  passwordHash: null,
};

function sqlText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(sqlText).join(' ');
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.queryChunks)) return sqlText(record.queryChunks);
    if (typeof record.name === 'string') return record.name;
    if (Array.isArray(record.value)) return sqlText(record.value);
    if (typeof record.value === 'string' || typeof record.value === 'number') {
      return String(record.value);
    }
  }
  return '';
}

describe('web sign-in refusal', () => {
  it('allows an active human with a password when password is required', () => {
    expect(webSignInBlockReason(HUMAN, { requirePassword: true })).toBeNull();
    expect(() => assertUserMayUseWebSignIn(HUMAN, { requirePassword: true })).not.toThrow();
  });

  it('blocks system users before any other check', () => {
    expect(webSignInBlockReason(SYSTEM, { requireActive: false })).toBe('system');
    expect(webSignInBlockReason({ ...SYSTEM, status: 'invited' })).toBe('system');
    expect(() => assertUserMayUseWebSignIn(SYSTEM)).toThrow(AppError);
    try {
      assertUserMayUseWebSignIn(SYSTEM);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('WEB_SIGN_IN_FORBIDDEN');
      expect((error as AppError).details).toEqual({ reason: 'system' });
    }
  });

  it('blocks inactive humans and missing passwords only when those checks are on', () => {
    expect(webSignInBlockReason({ ...HUMAN, status: 'invited' })).toBe('inactive');
    expect(
      webSignInBlockReason({ ...HUMAN, status: 'invited' }, { requireActive: false }),
    ).toBeNull();
    expect(
      webSignInBlockReason({ ...HUMAN, passwordHash: null }, { requirePassword: true }),
    ).toBe('no_password');
    expect(webSignInBlockReason(null)).toBe('missing');
  });

  it('allows SSO humans who have no password when password is not required', () => {
    expect(
      webSignInBlockReason({ ...HUMAN, passwordHash: null }, { requireActive: true }),
    ).toBeNull();
  });
});

describe('validateUserCategoryChange', () => {
  it('rejects changing your own category', () => {
    expect(() =>
      validateUserCategoryChange({
        existing: HUMAN,
        target: 'system',
        actorUserId: HUMAN.id,
      }),
    ).toThrowError(expect.objectContaining({ code: 'CANNOT_CHANGE_OWN_CATEGORY' }));
  });

  it('rejects converting a system administrator into a system user', () => {
    expect(() =>
      validateUserCategoryChange({
        existing: { ...HUMAN, isSystemAdmin: true },
        target: 'system',
        actorUserId: 'admin-other',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'SYSTEM_ADMIN_CANNOT_BE_SYSTEM_USER' }),
    );
  });

  it('rejects an unchanged category and inactive targets', () => {
    expect(() =>
      validateUserCategoryChange({
        existing: HUMAN,
        target: 'human',
        actorUserId: 'admin-other',
      }),
    ).toThrowError(expect.objectContaining({ code: 'USER_CATEGORY_UNCHANGED' }));
    expect(() =>
      validateUserCategoryChange({
        existing: { ...HUMAN, status: 'invited' },
        target: 'system',
        actorUserId: 'admin-other',
      }),
    ).toThrowError(expect.objectContaining({ code: 'USER_MUST_BE_ACTIVE' }));
  });

  it('allows an admin to convert another active human to system', () => {
    expect(() =>
      validateUserCategoryChange({
        existing: HUMAN,
        target: 'system',
        actorUserId: 'admin-other',
      }),
    ).not.toThrow();
  });

  it('records audit metadata and revokes web access only when becoming system', () => {
    expect(
      categoryChangeAuditMetadata({
        from: 'human',
        to: 'system',
        email: 'bot@example.com',
      }),
    ).toEqual({ from: 'human', to: 'system', email: 'bot@example.com' });
    expect(categoryChangeEffects('system')).toEqual({
      clearPassword: true,
      revokeWebAccess: true,
    });
    expect(categoryChangeEffects('human')).toEqual({
      clearPassword: false,
      revokeWebAccess: false,
    });
  });
});

describe('user create and update schemas', () => {
  it('accepts a system user without a password and rejects admin or invite flags', () => {
    const created = createUserSchema.parse({
      email: 'qa@example.com',
      displayName: 'QA bot',
      userType: 'system',
    });
    expect(created.userType).toBe('system');

    expect(
      createUserSchema.safeParse({
        email: 'qa@example.com',
        displayName: 'QA bot',
        userType: 'system',
        isSystemAdmin: true,
      }).success,
    ).toBe(false);
    expect(
      createUserSchema.safeParse({
        email: 'qa@example.com',
        displayName: 'QA bot',
        userType: 'system',
        password: 'Password1',
      }).success,
    ).toBe(false);
    expect(
      createUserSchema.safeParse({
        email: 'qa@example.com',
        displayName: 'QA bot',
        userType: 'system',
        sendInvite: true,
      }).success,
    ).toBe(false);
  });

  it('strips userType from the normal user patch schema', () => {
    const parsed = updateUserSchema.parse({
      displayName: 'Ada',
      userType: 'system',
    });
    expect(parsed.displayName).toBe('Ada');
    expect(parsed).not.toHaveProperty('userType');
    expect(changeUserCategorySchema.parse({ userType: 'system' }).userType).toBe(
      'system',
    );
    expect(changeUserCategorySchema.safeParse({ userType: 'ai_agent' }).success).toBe(
      false,
    );
  });
});

describe('toPublicUser', () => {
  it('exposes userType for human and system rows', () => {
    const base = {
      id: HUMAN.id,
      email: 'ada@example.com',
      displayName: 'Ada',
      fullName: null,
      passwordHash: 'hash',
      status: 'active',
      isSystemAdmin: false,
      idpSource: null,
      idpSubject: null,
      avatarContentType: null,
      preferredLocale: 'en',
      emailNotificationPrefs: {},
      displayPrefs: {},
      signupPendingEscalatedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    } as typeof users.$inferSelect;

    expect(toPublicUser({ ...base, userType: 'human' }).userType).toBe('human');
    expect(toPublicUser({ ...base, userType: 'system', passwordHash: null }).userType).toBe(
      'system',
    );
    expect(toPublicUser({ ...base, userType: 'system', passwordHash: null }).hasPassword).toBe(
      false,
    );
  });
});

describe('people-list filters', () => {
  it('defaults member queries to active humans and opts system users back in', () => {
    const hidden = sqlText(activeHumanUserConditions());
    expect(hidden).toContain('status');
    expect(hidden).toContain('active');
    expect(hidden).toContain('user_type');
    expect(hidden).toContain('human');

    const included = sqlText(activeHumanUserConditions({ includeSystemUsers: true }));
    expect(included).toContain('active');
    expect(included).not.toContain('user_type');
  });

  it('keeps assignment guards active-only, including system users', () => {
    const assignment = sqlText(activeMemberConditions());
    expect(assignment).toContain('status');
    expect(assignment).toContain('active');
    expect(assignment).not.toContain('user_type');
    expect(assignment).not.toContain('human');
    expect(assignment).not.toContain('system');
  });

  it('builds the utilization exclusion only when system users are hidden', () => {
    expect(sqlText(systemUserExclusionCondition())).toContain('human');
    expect(systemUserExclusionCondition({ includeSystemUsers: true })).toBeUndefined();
  });
});
