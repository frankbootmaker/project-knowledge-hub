import { describe, expect, it } from 'vitest';
import { raciDraftIssues, sameRaciDraft } from './raci-draft';

describe('raciDraftIssues', () => {
  it('accepts exactly one Accountable and distinct people', () => {
    expect(
      raciDraftIssues([
        { userId: 'a', role: 'A' },
        { userId: 'b', role: 'R' },
        { userId: 'c', role: 'C' },
      ]),
    ).toEqual([]);
  });

  it('requires exactly one Accountable', () => {
    expect(raciDraftIssues([])).toEqual(['exactly_one_accountable']);
    expect(raciDraftIssues([{ userId: 'a', role: 'R' }])).toEqual([
      'exactly_one_accountable',
    ]);
    expect(
      raciDraftIssues([
        { userId: 'a', role: 'A' },
        { userId: 'b', role: 'A' },
      ]),
    ).toEqual(['exactly_one_accountable']);
  });

  it('rejects a repeated person and role, and a person with two roles', () => {
    expect(
      raciDraftIssues([
        { userId: 'a', role: 'A' },
        { userId: 'a', role: 'A' },
      ]),
    ).toEqual([
      'exactly_one_accountable',
      'duplicate_person_role',
      'duplicate_person',
    ]);
    expect(
      raciDraftIssues([
        { userId: 'a', role: 'A' },
        { userId: 'b', role: 'R' },
        { userId: 'b', role: 'C' },
      ]),
    ).toEqual(['duplicate_person']);
  });
});

describe('sameRaciDraft', () => {
  it('ignores order and display-only differences', () => {
    expect(
      sameRaciDraft(
        [
          { userId: 'b', role: 'R' },
          { userId: 'a', role: 'A' },
        ],
        [
          { userId: 'a', role: 'A' },
          { userId: 'b', role: 'R' },
        ],
      ),
    ).toBe(true);
    expect(
      sameRaciDraft(
        [{ userId: 'a', role: 'A' }],
        [{ userId: 'a', role: 'R' }],
      ),
    ).toBe(false);
  });
});
