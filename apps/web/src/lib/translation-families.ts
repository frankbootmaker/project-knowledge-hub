/** Group and pick preferred locale siblings for catalogue lists. */

export type TranslationFamilyRecord = {
  id: string;
  language?: string | null;
  translationGroupId?: string | null;
};

export function normalizeContentLanguage(language: string | null | undefined): string {
  const trimmed = language?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : 'en';
}

export function pickPreferredRecord<T extends TranslationFamilyRecord>(
  records: T[],
  preferredLanguage: string,
): T {
  if (records.length === 0) {
    throw new Error('pickPreferredRecord requires at least one record');
  }
  const preferred = normalizeContentLanguage(preferredLanguage);
  const byLang = new Map(
    records.map((record) => [normalizeContentLanguage(record.language), record] as const),
  );
  return byLang.get(preferred) ?? byLang.get('en') ?? records[0]!;
}

/**
 * Groups records that share a translationGroupId. Records without a group id
 * stay as singleton families. Group order follows first appearance in `records`.
 */
export function groupRecordsByTranslationFamily<T extends TranslationFamilyRecord>(
  records: T[],
): T[][] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];

  for (const record of records) {
    const key = record.translationGroupId?.trim()
      ? `group:${record.translationGroupId}`
      : `solo:${record.id}`;
    if (!groups.has(key)) {
      order.push(key);
      groups.set(key, []);
    }
    groups.get(key)!.push(record);
  }

  return order.map((key) => groups.get(key)!);
}
