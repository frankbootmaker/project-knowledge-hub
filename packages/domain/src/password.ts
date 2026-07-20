import { z } from 'zod';

/** Minimum length accepted by the platform. */
export const PASSWORD_MIN_LENGTH = 8;

/** Length at which a policy-compliant password is considered strong. */
export const PASSWORD_STRONG_LENGTH = 12;

export type PasswordRequirementKey = 'length' | 'uppercase' | 'nonLetter';

export type PasswordStrengthLevel = 'empty' | 'weak' | 'fair' | 'safe' | 'strong';

export type PasswordStrength = {
  level: PasswordStrengthLevel;
  /** 0–4 for meter segments */
  score: number;
  acceptable: boolean;
  requirements: Record<PasswordRequirementKey, boolean>;
};

export function passwordHasUppercase(password: string): boolean {
  return /[A-Z]/.test(password);
}

/** Digit, punctuation, symbol, or other non-letter character. */
export function passwordHasNonLetter(password: string): boolean {
  return /[^A-Za-z]/.test(password);
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  const requirements = {
    length: password.length >= PASSWORD_MIN_LENGTH,
    uppercase: passwordHasUppercase(password),
    nonLetter: passwordHasNonLetter(password),
  };

  const metCount = Object.values(requirements).filter(Boolean).length;
  const acceptable = metCount === 3;

  if (!password) {
    return { level: 'empty', score: 0, acceptable: false, requirements };
  }

  if (!acceptable) {
    return {
      level: metCount <= 1 ? 'weak' : 'fair',
      score: metCount,
      acceptable: false,
      requirements,
    };
  }

  if (password.length >= PASSWORD_STRONG_LENGTH) {
    return { level: 'strong', score: 4, acceptable: true, requirements };
  }

  return { level: 'safe', score: 3, acceptable: true, requirements };
}

const WEAK_PASSWORD_MESSAGE =
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include an uppercase letter and a non-letter character`;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(200)
  .superRefine((value, ctx) => {
    const strength = evaluatePasswordStrength(value);
    if (!strength.acceptable) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: WEAK_PASSWORD_MESSAGE,
      });
    }
  });

/** Optional password for admin patches (empty / omitted handled by caller). */
export const optionalPasswordSchema = passwordSchema.optional();
