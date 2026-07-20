'use client';

import { useTranslations } from 'next-intl';
import {
  evaluatePasswordStrength,
  type PasswordRequirementKey,
  type PasswordStrengthLevel,
} from '@project-knowledge-hub/domain';
import { cn } from '../../lib/cn';

const levelTone: Record<
  Exclude<PasswordStrengthLevel, 'empty'>,
  { bar: string; label: string }
> = {
  weak: { bar: 'bg-danger', label: 'text-danger' },
  fair: { bar: 'bg-warn', label: 'text-warn' },
  safe: { bar: 'bg-accent', label: 'text-accent' },
  strong: { bar: 'bg-brand', label: 'text-brand' },
};

const requirementKeys: PasswordRequirementKey[] = [
  'length',
  'uppercase',
  'nonLetter',
];

export function PasswordStrengthHint({ value }: { value: string }) {
  const t = useTranslations('common');
  const strength = evaluatePasswordStrength(value);

  if (!value) return null;

  const tone = levelTone[strength.level === 'empty' ? 'weak' : strength.level];
  const filled = Math.max(1, strength.score);

  return (
    <div className="grid gap-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div
          className="grid h-1.5 flex-1 grid-cols-4 gap-1"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={strength.score}
          aria-label={t('passwordStrengthLabel')}
        >
          {Array.from({ length: 4 }, (_, index) => (
            <span
              key={index}
              className={cn(
                'rounded-full bg-line',
                index < filled ? tone.bar : null,
              )}
            />
          ))}
        </div>
        <span className={cn('shrink-0 text-xs font-medium', tone.label)}>
          {t(`passwordStrength.${strength.level}`)}
        </span>
      </div>
      <ul className="m-0 grid list-none gap-1 p-0 text-xs text-ink-muted">
        {requirementKeys.map((key) => {
          const met = strength.requirements[key];
          return (
            <li key={key} className={cn('flex items-center gap-1.5', met && 'text-ink')}>
              <span aria-hidden className={met ? 'text-accent' : 'text-ink-muted'}>
                {met ? '✓' : '○'}
              </span>
              {t(`passwordRequirements.${key}`)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
