/**
 * URL slug for newly created records, projects, workspaces, orgs, systems,
 * tags, and git-sync docs.
 *
 * NFKD, strip combining marks, then fold letters that do not decompose
 * (ß → ss, ø → o, ł → l, æ → ae, œ → oe, đ → d, þ → th, and similar).
 * Stored slugs are not rewritten: an existing a-z0-9 hyphen slug round-trips,
 * and callers must not regenerate a slug from a title on update.
 */
export const SLUG_MAX_LENGTH = 96;

/** Letters NFKD leaves intact. Values are already lowercase ASCII. */
const SPECIAL_LETTER_FOLDS: Readonly<Record<string, string>> = {
  ß: 'ss',
  ẞ: 'ss',
  ø: 'o',
  Ø: 'o',
  ł: 'l',
  Ł: 'l',
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  Œ: 'oe',
  đ: 'd',
  Đ: 'd',
  ð: 'd',
  Ð: 'd',
  þ: 'th',
  Þ: 'th',
  ħ: 'h',
  Ħ: 'h',
  ı: 'i',
  ŋ: 'ng',
  Ŋ: 'ng',
  ŧ: 't',
  Ŧ: 't',
  ĸ: 'k',
};

function foldSpecialLetters(value: string): string {
  return Array.from(value, (char) => SPECIAL_LETTER_FOLDS[char] ?? char).join('');
}

export function slugify(input: string): string {
  const transliterated = foldSpecialLetters(
    input.normalize('NFKD').replace(/\p{M}/gu, ''),
  );
  return transliterated
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH);
}
