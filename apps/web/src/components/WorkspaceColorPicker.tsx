'use client';

import { useTranslations } from 'next-intl';
import {
  WORKSPACE_COLORS,
  resolveWorkspaceColor,
  type WorkspaceColor,
  workspaceSwatchClassName,
} from '../lib/workspace-colors';
import { cn } from '../lib/cn';

export function WorkspaceColorPicker(props: {
  value: WorkspaceColor | null;
  seed: string;
  onChange: (color: WorkspaceColor | null) => void;
  allowAuto?: boolean;
}) {
  const t = useTranslations('workspaces');
  const preview = resolveWorkspaceColor(props.value, props.seed || 'workspace');

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {props.allowAuto !== false ? (
          <button
            type="button"
            className={cn(
              'kh-workspace-swatch-btn',
              `kh-workspace-color-${preview}`,
              props.value == null && 'kh-workspace-swatch-btn-active',
            )}
            onClick={() => props.onChange(null)}
            title={t('colorAuto')}
            aria-label={t('colorAuto')}
          >
            <span className={workspaceSwatchClassName(preview)} />
            <span className="text-[0.65rem] text-ink-muted">{t('colorAutoShort')}</span>
          </button>
        ) : null}
        {WORKSPACE_COLORS.map((color) => (
          <button
            type="button"
            key={color}
            className={cn(
              'kh-workspace-swatch-btn',
              `kh-workspace-color-${color}`,
              props.value === color && 'kh-workspace-swatch-btn-active',
            )}
            onClick={() => props.onChange(color)}
            title={t(`color_${color}`)}
            aria-label={t(`color_${color}`)}
          >
            <span className={workspaceSwatchClassName(color)} />
          </button>
        ))}
      </div>
    </div>
  );
}
