import { describe, expect, it, vi } from 'vitest';
import {
  applyTableView,
  collectEnumOptions,
  compareSortValues,
  compareText,
  createDebouncedUrlWriter,
  hasActiveFilters,
  parseTableQuery,
  readTableState,
  reduceTableState,
  sanitizeEnumFilters,
  serializeTableQuery,
  URL_WRITE_DELAY_MS,
  type TableQueryState,
} from './data-table';

type Row = {
  id: string;
  title: string;
  status: string;
  owner: string | null;
  hours: number | null;
  updatedAt: string | null;
};

const rows: Row[] = [
  {
    id: 'b',
    title: 'Beta',
    status: 'done',
    owner: 'Ada',
    hours: 2,
    updatedAt: '2026-01-02',
  },
  {
    id: 'a',
    title: 'alpha',
    status: 'todo',
    owner: null,
    hours: null,
    updatedAt: null,
  },
  {
    id: 'c',
    title: 'Álom',
    status: 'todo',
    owner: 'Bea',
    hours: 10,
    updatedAt: '2026-03-01',
  },
];

const columns = [
  {
    id: 'title',
    sort: {
      type: 'text' as const,
      getValue: (row: Row) => row.title,
      defaultDir: 'asc' as const,
    },
    filter: { type: 'text' as const, getValue: (row: Row) => row.title },
  },
  {
    id: 'status',
    sort: { type: 'text' as const, getValue: (row: Row) => row.status },
    filter: { type: 'enum' as const, getValue: (row: Row) => row.status },
  },
  {
    id: 'hours',
    sort: {
      type: 'number' as const,
      getValue: (row: Row) => row.hours ?? -1,
      defaultDir: 'desc' as const,
    },
  },
  {
    id: 'updated',
    sort: {
      type: 'date' as const,
      getValue: (row: Row) => row.updatedAt ?? '',
      defaultDir: 'desc' as const,
    },
  },
];

function baseState(
  patch: Partial<TableQueryState> = {},
): TableQueryState {
  return {
    q: '',
    sortKey: 'updated',
    sortDir: 'desc',
    filters: {},
    textFilters: {},
    extras: {},
    ...patch,
  };
}

describe('compareSortValues', () => {
  it('sorts text with the active locale', () => {
    expect(compareText('Álom', 'Beta', 'hu')).toBeLessThan(0);
    expect(compareText('alpha', 'Beta', 'en')).toBeLessThan(0);
    expect(compareSortValues('Álom', 'Beta', 'text', 'hu')).toBeLessThan(0);
  });

  it('sorts numbers and treats missing values as smallest', () => {
    expect(compareSortValues(2, 10, 'number', 'en')).toBeLessThan(0);
    expect(compareSortValues(null, 0, 'number', 'en')).toBeLessThan(0);
    expect(compareSortValues(-1, 2, 'number', 'en')).toBeLessThan(0);
    expect(compareSortValues(null, undefined, 'number', 'en')).toBe(0);
    expect(compareSortValues('', null, 'number', 'en')).toBe(0);
  });

  it('reuses one collator per locale', () => {
    const spy = vi.spyOn(Intl, 'Collator');
    const locale = 'zu-x-kh-collator';
    compareText('á', 'b', locale);
    compareText('b', 'á', locale);
    const created = spy.mock.calls.filter((call) => call[0] === locale);
    expect(created).toHaveLength(1);
    spy.mockRestore();
  });

  it('sorts ISO dates and keeps blanks first', () => {
    expect(compareSortValues('2026-01-02', '2026-03-01', 'date', 'en'))
      .toBeLessThan(0);
    expect(compareSortValues('', '2026-01-02', 'date', 'en')).toBeLessThan(0);
  });
});

describe('reduceTableState', () => {
  it('flips direction on the active column and uses the column default otherwise', () => {
    const flipped = reduceTableState(baseState(), {
      type: 'toggleSort',
      key: 'updated',
      defaultDir: 'desc',
    });
    expect(flipped.sortDir).toBe('asc');
    const next = reduceTableState(flipped, {
      type: 'toggleSort',
      key: 'hours',
      defaultDir: 'desc',
    });
    expect(next).toMatchObject({ sortKey: 'hours', sortDir: 'desc' });
  });

  it('clears column filters without dropping search or extras', () => {
    const cleared = reduceTableState(
      baseState({
        q: 'ada',
        filters: { status: ['todo'] },
        textFilters: { title: 'be' },
        extras: { kind: 'risk' },
      }),
      { type: 'clearFilters' },
    );
    expect(cleared.q).toBe('ada');
    expect(cleared.extras).toEqual({ kind: 'risk' });
    expect(hasActiveFilters(cleared)).toBe(false);
  });
});

describe('applyTableView', () => {
  it('filters by enum multi-select and text, then sorts with a tie-break', () => {
    const visible = applyTableView({
      rows,
      locale: 'en',
      query: '',
      sortKey: 'status',
      sortDir: 'asc',
      filters: { status: ['todo', 'done'] },
      textFilters: {},
      columns,
      tieBreak: (a, b) => compareText(a.title, b.title, 'en'),
    });
    expect(visible.map((row) => row.id)).toEqual(['b', 'c', 'a']);

    const titled = applyTableView({
      rows,
      locale: 'en',
      query: '',
      sortKey: 'title',
      sortDir: 'asc',
      filters: { status: ['todo'] },
      textFilters: { title: 'AL' },
      columns,
      tieBreak: (a, b) => compareText(a.id, b.id, 'en'),
    });
    expect(titled.map((row) => row.id)).toEqual(['a']);
  });

  it('searches before sorting and reverses the tie-break with direction', () => {
    const desc = applyTableView({
      rows,
      locale: 'en',
      query: 'a',
      search: (row, needle) => row.title.toLowerCase().includes(needle),
      sortKey: 'status',
      sortDir: 'desc',
      filters: {},
      textFilters: {},
      columns,
      tieBreak: (a, b) => compareText(a.title, b.title, 'en'),
    });
    expect(desc.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('leaves the incoming order when no sort column is active', () => {
    const visible = applyTableView({
      rows,
      locale: 'en',
      query: '',
      sortKey: null,
      sortDir: 'asc',
      filters: {},
      textFilters: {},
      columns,
    });
    expect(visible.map((row) => row.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('table query string', () => {
  it('round-trips sort, search, and filters without dropping other params', () => {
    const state = baseState({
      q: 'board',
      sortKey: 'title',
      sortDir: 'asc',
      filters: { status: ['todo', 'in_progress'] },
      textFilters: { title: 'alpha' },
      extras: { kind: 'risk' },
    });
    const search = serializeTableQuery('?delivery=list&task=abc', 'dl', state, {
      sortKey: 'updated',
      sortDir: 'desc',
    });
    const params = new URLSearchParams(search.slice(1));
    expect(params.get('delivery')).toBe('list');
    expect(params.get('task')).toBe('abc');
    expect(params.get('dl_q')).toBe('board');
    expect(params.get('dl_sort')).toBe('title');
    expect(params.get('dl_dir')).toBe('asc');
    expect(params.getAll('dl_f_status')).toEqual(['todo', 'in_progress']);
    expect(params.get('dl_t_title')).toBe('alpha');
    expect(params.get('dl_x_kind')).toBe('risk');

    const parsed = readTableState(search, 'dl', {
      sortKey: 'updated',
      sortDir: 'desc',
    });
    expect(parsed).toEqual(state);
    expect(parseTableQuery(search, 'raid').q).toBe('');
    expect(parseTableQuery(search, 'raid').sortKey).toBeNull();
  });

  it('omits default sort and empty filters', () => {
    const search = serializeTableQuery(
      '?delivery=board',
      'dl',
      baseState(),
      { sortKey: 'updated', sortDir: 'desc' },
    );
    expect(search).toBe('?delivery=board');
  });

  it('keeps two lists on one page from sharing keys', () => {
    const withDelivery = serializeTableQuery('', 'dl', baseState({ q: 'one' }), {
      sortKey: 'updated',
      sortDir: 'desc',
    });
    const both = serializeTableQuery(
      withDelivery,
      'lkno',
      baseState({ q: 'two', sortKey: 'title', sortDir: 'asc' }),
      { sortKey: null, sortDir: 'asc' },
    );
    const params = new URLSearchParams(both.slice(1));
    expect(params.get('dl_q')).toBe('one');
    expect(params.get('lkno_q')).toBe('two');
    expect(params.get('lkno_sort')).toBe('title');
  });
});

describe('sanitizeEnumFilters', () => {
  it('drops unknown values and labels a blank enum as a dash', () => {
    const next = sanitizeEnumFilters(
      { kind: ['risk', 'nope'], owner: ['__none__'] },
      [
        {
          id: 'kind',
          filter: {
            type: 'enum',
            getValue: () => 'risk',
            options: [{ value: 'risk', label: 'Risk' }],
          },
        },
        {
          id: 'owner',
          filter: {
            type: 'enum',
            getValue: () => '',
            options: [{ value: '__none__', label: '—' }],
          },
        },
        {
          id: 'title',
          filter: { type: 'text', getValue: () => '' },
        },
      ],
    );
    expect(next).toEqual({ kind: ['risk'], owner: ['__none__'] });
    expect(
      collectEnumOptions(
        [{ owner: null as string | null }],
        (row) => row.owner ?? '',
        (value) => value,
        'en',
      ),
    ).toEqual([{ value: '__none__', label: '—' }]);
  });
});

describe('createDebouncedUrlWriter', () => {
  it('writes the latest value after the delay and flushes immediately', () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let value = '';
    const writer = createDebouncedUrlWriter({
      write: () => writes.push(value),
    });
    value = 'a';
    writer.push();
    value = 'ab';
    writer.push();
    vi.advanceTimersByTime(URL_WRITE_DELAY_MS - 1);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(writes).toEqual(['ab']);

    value = 'abc';
    writer.push();
    writer.flush();
    expect(writes).toEqual(['ab', 'abc']);
    vi.advanceTimersByTime(URL_WRITE_DELAY_MS);
    expect(writes).toEqual(['ab', 'abc']);

    value = 'drop';
    writer.push();
    writer.cancel();
    vi.advanceTimersByTime(URL_WRITE_DELAY_MS);
    expect(writes).toEqual(['ab', 'abc']);
    vi.useRealTimers();
  });
});
