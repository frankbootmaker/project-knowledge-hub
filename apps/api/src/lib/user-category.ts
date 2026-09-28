import { eq, type SQL } from 'drizzle-orm';
import { users } from '@project-knowledge-hub/database';
import {
  AppError,
  passwordSchema,
  userStatusSchema,
  userTypeSchema,
  type UserType,
} from '@project-knowledge-hub/domain';
import { z } from 'zod';

export type WebSignInSubject = {
  userType: string;
  status?: string;
  passwordHash?: string | null;
};

export type WebSignInBlock = 'missing' | 'system' | 'inactive' | 'no_password';

/**
 * Why this account must not start or keep a web session.
 * Password login, OIDC, reset/invite confirm, and session-cookie resolution
 * all call this so the rule stays in one place.
 */
export function webSignInBlockReason(
  user: WebSignInSubject | null | undefined,
  options: { requirePassword?: boolean; requireActive?: boolean } = {},
): WebSignInBlock | null {
  if (!user) return 'missing';
  if (user.userType === 'system') return 'system';
  const requireActive = options.requireActive !== false;
  if (requireActive && user.status !== 'active') return 'inactive';
  if (options.requirePassword && !user.passwordHash) return 'no_password';
  return null;
}

/** Throws when the account must not use the web UI. Login maps this to invalid credentials. */
export function assertUserMayUseWebSignIn(
  user: WebSignInSubject | null | undefined,
  options: { requirePassword?: boolean; requireActive?: boolean } = {},
): asserts user is WebSignInSubject {
  const reason = webSignInBlockReason(user, options);
  if (!reason) return;
  throw new AppError({
    code: 'WEB_SIGN_IN_FORBIDDEN',
    message: 'This account cannot sign in to the web interface',
    statusCode: 403,
    details: { reason },
  });
}

export type CategoryChangeSubject = {
  id: string;
  userType: string;
  isSystemAdmin: boolean;
  status: string;
};

/** Admin-only category change rules. Does not touch the database. */
export function validateUserCategoryChange(input: {
  existing: CategoryChangeSubject;
  target: UserType;
  actorUserId: string;
}): void {
  if (input.existing.id === input.actorUserId) {
    throw new AppError({
      code: 'CANNOT_CHANGE_OWN_CATEGORY',
      message: 'You cannot change your own user category',
      statusCode: 400,
    });
  }
  if (input.existing.userType === input.target) {
    throw new AppError({
      code: 'USER_CATEGORY_UNCHANGED',
      message: `User is already a ${input.target} user`,
      statusCode: 400,
    });
  }
  if (input.target === 'system' && input.existing.isSystemAdmin) {
    throw new AppError({
      code: 'SYSTEM_ADMIN_CANNOT_BE_SYSTEM_USER',
      message: 'A system administrator cannot be converted to a system user',
      statusCode: 400,
    });
  }
  if (input.target === 'system' && input.existing.status !== 'active') {
    throw new AppError({
      code: 'USER_MUST_BE_ACTIVE',
      message: 'Only active users can be converted to system users',
      statusCode: 400,
    });
  }
}

export function categoryChangeAuditMetadata(input: {
  from: string;
  to: string;
  email: string;
}): { from: string; to: string; email: string } {
  return { from: input.from, to: input.to, email: input.email };
}

/** Converting to system drops password login and any live web credentials. */
export function categoryChangeEffects(target: UserType): {
  clearPassword: boolean;
  revokeWebAccess: boolean;
} {
  return {
    clearPassword: target === 'system',
    revokeWebAccess: target === 'system',
  };
}

/**
 * Active-member filter for pickers and assignment checks.
 * System users are omitted unless includeSystemUsers is set.
 */
export function activeHumanUserConditions(
  options: { includeSystemUsers?: boolean } = {},
): SQL[] {
  const conditions: SQL[] = [eq(users.status, 'active')];
  if (!options.includeSystemUsers) {
    conditions.push(eq(users.userType, 'human'));
  }
  return conditions;
}

/** Roster/utilization rows: drop system users unless explicitly requested. */
export function systemUserExclusionCondition(
  options: { includeSystemUsers?: boolean } = {},
): SQL | undefined {
  if (options.includeSystemUsers) return undefined;
  return eq(users.userType, 'human');
}

/** Personal dashboard insights are empty for system users unless opted in. */
export function shouldOmitPersonalInsights(
  userType: string | null | undefined,
  options: { includeSystemUsers?: boolean } = {},
): boolean {
  return userType === 'system' && !options.includeSystemUsers;
}

const idpPairRefine = (
  value: { idpSource?: string | null; idpSubject?: string | null },
  ctx: z.RefinementCtx,
  mode: 'create' | 'update',
) => {
  if (mode === 'update') {
    if (value.idpSource === undefined && value.idpSubject === undefined) return;
    const source = value.idpSource;
    const subject = value.idpSubject;
    const clearing =
      (source === null || source === '') && (subject === null || subject === '');
    const bothSet =
      typeof source === 'string' &&
      source.trim().length > 0 &&
      typeof subject === 'string' &&
      subject.trim().length > 0;
    if (!clearing && !bothSet) {
      if (
        (source === null && subject !== null && subject !== undefined) ||
        (subject === null && source !== null && source !== undefined)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'IdP source and subject must be cleared or set together',
          path: ['idpSource'],
        });
      }
    }
    return;
  }

  const hasSource = Boolean(value.idpSource?.trim());
  const hasSubject = Boolean(value.idpSubject?.trim());
  if (hasSource !== hasSubject) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'IdP source and subject must be set together',
      path: ['idpSource'],
    });
  }
};

export const createUserSchema = z
  .object({
    email: z.string().email().max(320),
    displayName: z.string().min(1).max(160),
    fullName: z.string().max(200).nullable().optional(),
    password: passwordSchema.optional(),
    sendInvite: z.boolean().optional(),
    status: userStatusSchema.optional(),
    isSystemAdmin: z.boolean().optional(),
    userType: userTypeSchema.optional(),
    idpSource: z.string().min(1).max(64).nullable().optional(),
    idpSubject: z.string().min(1).max(320).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const isSystem = value.userType === 'system';
    if (isSystem && (value.password || value.sendInvite)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'System users cannot have passwords or be invited. They authenticate via API tokens only.',
        path: ['userType'],
      });
    }
    if (isSystem && value.isSystemAdmin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'System users cannot be system administrators',
        path: ['isSystemAdmin'],
      });
    }
    if (isSystem && value.status && value.status !== 'active') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'System users must have status "active"',
        path: ['status'],
      });
    }
    if (!isSystem && value.sendInvite === false && !value.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password is required unless sending an invite',
        path: ['password'],
      });
    }
    idpPairRefine(value, ctx, 'create');
  });

/** Normal user patch. Unknown keys, including userType, are stripped. */
export const updateUserSchema = z
  .object({
    displayName: z.string().min(1).max(160).optional(),
    fullName: z.string().max(200).nullable().optional(),
    status: userStatusSchema.optional(),
    isSystemAdmin: z.boolean().optional(),
    password: passwordSchema.optional(),
    idpSource: z.string().min(1).max(64).nullable().optional(),
    idpSubject: z.string().min(1).max(320).nullable().optional(),
  })
  .strip()
  .superRefine((value, ctx) => {
    idpPairRefine(value, ctx, 'update');
  });

export const changeUserCategorySchema = z.object({
  userType: userTypeSchema,
});
