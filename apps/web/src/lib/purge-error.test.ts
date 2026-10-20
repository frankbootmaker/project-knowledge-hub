import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import de from '../../messages/de.json';
import en from '../../messages/en.json';
import hu from '../../messages/hu.json';
import { purgeFailureLines, type PurgeErrorBody } from './purge-error';

function translate(locale: 'en' | 'hu' | 'de', messages: typeof en) {
  const t = createTranslator({ locale, messages, namespace: 'archive' });
  return (key: string, values?: Record<string, string | number>) =>
    t(key as 'failedDelete', values);
}

const blocked: PurgeErrorBody = {
  error: {
    code: 'WORKSPACE_PURGE_BLOCKED',
    message: '20 media files used by MIL-T-53 in workspace MileGuide',
    details: {
      blockers: [
        {
          count: 20,
          itemKey: 'MIL-T-53',
          itemTitle: 'Screenshots',
          workspaceName: 'MileGuide',
        },
      ],
    },
  },
};

describe('purgeFailureLines', () => {
  it('renders the English blocker sentence for PRO-B-31', () => {
    const lines = purgeFailureLines(blocked, translate('en', en));
    expect(lines).toEqual(['20 media files used by MIL-T-53 in workspace MileGuide']);
  });

  it('translates the blocker and the foreign-key messages in Hungarian', () => {
    const t = translate('hu', hu);
    expect(purgeFailureLines(blocked, t)[0]).toContain('MIL-T-53');
    expect(purgeFailureLines(blocked, t)[0]).toContain('MileGuide');
    expect(purgeFailureLines(blocked, t)[0]).not.toBe(
      '20 media files used by MIL-T-53 in workspace MileGuide',
    );
    expect(purgeFailureLines({ error: { code: 'STILL_REFERENCED' } }, t)).toEqual([
      'Nem törölhető: más rekordok még hivatkoznak rá',
    ]);
    expect(purgeFailureLines({ error: { code: 'INVALID_REFERENCE' } }, t)).toEqual([
      'A hivatkozott rekord nem létezik',
    ]);
  });

  it('keeps the English sanitizer sentences and translates them in German', () => {
    expect(en.archive.cannotDeleteReferenced).toBe(
      'Cannot delete: still referenced by other records',
    );
    expect(en.archive.referencedRecordMissing).toBe('Referenced record does not exist');
    const t = translate('de', de);
    expect(purgeFailureLines({ error: { code: 'STILL_REFERENCED' } }, t)[0]).toMatch(
      /Löschen nicht möglich/,
    );
    expect(purgeFailureLines(blocked, t)[0]).toContain('MIL-T-53');
    expect(purgeFailureLines(blocked, t)[0]).toContain('MileGuide');
  });
});
