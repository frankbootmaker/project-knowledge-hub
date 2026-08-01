import { describe, expect, it } from 'vitest';
import {
  groupRecordsByTranslationFamily,
  normalizeContentLanguage,
  pickPreferredRecord,
} from './translation-families';

describe('translation-families', () => {
  it('normalizes empty language to en', () => {
    expect(normalizeContentLanguage(null)).toBe('en');
    expect(normalizeContentLanguage('  DE ')).toBe('de');
  });

  it('groups by translationGroupId and keeps solos', () => {
    const groups = groupRecordsByTranslationFamily([
      { id: '1', language: 'en', translationGroupId: 'g1' },
      { id: '2', language: 'hu', translationGroupId: 'g1' },
      { id: '3', language: 'en', translationGroupId: null },
      { id: '4', language: 'de', translationGroupId: 'g1' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.map((r) => r.id)).toEqual(['1', '2', '4']);
    expect(groups[1]!.map((r) => r.id)).toEqual(['3']);
  });

  it('picks UI locale, then en, then first', () => {
    const family = [
      { id: 'en', language: 'en', translationGroupId: 'g' },
      { id: 'hu', language: 'hu', translationGroupId: 'g' },
      { id: 'de', language: 'de', translationGroupId: 'g' },
    ];
    expect(pickPreferredRecord(family, 'hu').id).toBe('hu');
    expect(pickPreferredRecord(family, 'fr').id).toBe('en');
    expect(
      pickPreferredRecord(
        [
          { id: 'de', language: 'de', translationGroupId: 'g' },
          { id: 'hu', language: 'hu', translationGroupId: 'g' },
        ],
        'fr',
      ).id,
    ).toBe('de');
  });
});
