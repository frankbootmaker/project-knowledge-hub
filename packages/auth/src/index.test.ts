import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  SLUG_MAX_LENGTH,
  slugify,
  verifyPassword,
} from './index.js';

describe('auth primitives', () => {
  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('hashes session tokens deterministically', () => {
    const token = createSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(token);
  });

  it('slugifies names', () => {
    expect(slugify('Home Infrastructure')).toBe('home-infrastructure');
  });

  it('transliterates Hungarian instead of dropping accents', () => {
    expect(slugify('AI Lawyer – nyitott kérdések jogi átnézése')).toBe(
      'ai-lawyer-nyitott-kerdesek-jogi-atnezese',
    );
    expect(slugify('kérdések')).toBe('kerdesek');
  });

  it('transliterates German sharp s and umlauts', () => {
    expect(slugify('Straße Größe')).toBe('strasse-grosse');
    expect(slugify('Fußgängerübergang')).toBe('fussgangerubergang');
    expect(slugify('GROßE')).toBe('grosse');
  });

  it('transliterates Polish, including ł', () => {
    expect(slugify('Zażółć gęślą jaźń')).toBe('zazolc-gesla-jazn');
    expect(slugify('Łódź')).toBe('lodz');
  });

  it('transliterates French accents and œ', () => {
    expect(slugify('Café déjà vu – œuvre naïve')).toBe(
      'cafe-deja-vu-oeuvre-naive',
    );
    expect(slugify('français')).toBe('francais');
  });

  it('transliterates Nordic æ, ø, å, and þ', () => {
    expect(slugify('Smørrebrød på Ærø')).toBe('smorrebrod-pa-aero');
    expect(slugify('Þór og Ærø')).toBe('thor-og-aero');
    expect(slugify('Þingvellir')).toBe('thingvellir');
  });

  it('leaves an existing ascii slug unchanged', () => {
    const legacy = 'ai-lawyer-nyitott-k-rd-sek-jogi-tn-z-se';
    expect(slugify(legacy)).toBe(legacy);
    expect(slugify('home-infrastructure')).toBe('home-infrastructure');
    expect(slugify(slugify('Straße Größe'))).toBe('strasse-grosse');
  });

  it('keeps a locale suffix on a max-length source slug', () => {
    const source = slugify(
      'OPE-DEP-1 Open Design on strix-halo-s1 Final Working Technical Configuration',
    );
    expect(source.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    const translated = slugify(`${source}-de`);
    expect(translated.endsWith('-de')).toBe(true);
    expect(translated).not.toBe(source);
    expect(translated.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });
});
