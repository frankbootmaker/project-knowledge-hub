export type SortDir = 'asc' | 'desc';

export type SortType = 'text' | 'number' | 'date';

export type ColumnKind =
  | 'text'
  | 'data'
  | 'status'
  | 'number'
  | 'date'
  | 'actions';

/** Sentinel stored in URLs for blank enum values (missing owner, and so on). */
export const EMPTY_FILTER_VALUE = '__none__';

export type SortValue = string | number | null | undefined;

export type SortSpec<T> = {
  type: SortType;
  getValue?: (row: T) => SortValue;
  compare?: (a: T, b: T) => number;
  defaultDir?: SortDir;
};

export type EnumFilterSpec<T> = {
  type: 'enum';
  getValue: (row: T) => string | string[] | null | undefined;
  options?: Array<{ value: string; label: string }>;
};

export type TextFilterSpec<T> = {
  type: 'text';
  getValue: (row: T) => string | null | undefined;
};

export type FilterSpec<T> = EnumFilterSpec<T> | TextFilterSpec<T>;

export type TableColumnSpec<T> = {
  id: string;
  sort?: SortSpec<T>;
  filter?: FilterSpec<T>;
};

export type TableQueryState = {
  q: string;
  sortKey: string | null;
  sortDir: SortDir;
  filters: Record<string, string[]>;
  textFilters: Record<string, string>;
  extras: Record<string, string>;
};

export type TableAction =
  | { type: 'hydrate'; state: TableQueryState }
  | { type: 'query'; q: string }
  | { type: 'toggleSort'; key: string; defaultDir?: SortDir }
  | { type: 'enum'; key: string; values: string[] }
  | { type: 'text'; key: string; value: string }
  | { type: 'extra'; key: string; value: string }
  | { type: 'clearFilters' };

export function compareText(a: string, b: string, locale: string): number {
  return a.localeCompare(b, locale, { sensitivity: 'base' });
}

function asNumber(value: SortValue): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

export function compareSortValues(
  a: SortValue,
  b: SortValue,
  type: SortType,
  locale: string,
): number {
  if (type === 'number') return asNumber(a) - asNumber(b);
  const left = a == null ? '' : String(a);
  const right = b == null ? '' : String(b);
  if (type === 'date') {
    if (left === '' && right === '') return 0;
    if (left === '') return -1;
    if (right === '') return 1;
    return left.localeCompare(right);
  }
  return compareText(left, right, locale);
}

export function columnKindClass(kind: ColumnKind): string {
  switch (kind) {
    case 'text':
      return 'kh-ops-cell-text';
    case 'number':
      return 'kh-ops-cell-number kh-ops-num';
    case 'date':
      return 'kh-ops-cell-date';
    case 'status':
      return 'kh-ops-cell-status';
    case 'actions':
      return 'kh-ops-cell-actions';
    default:
      return 'kh-ops-cell-data';
  }
}

export function reduceTableState(
  state: TableQueryState,
  action: TableAction,
): TableQueryState {
  switch (action.type) {
    case 'hydrate':
      return action.state;
    case 'query':
      return { ...state, q: action.q };
    case 'toggleSort': {
      if (state.sortKey === action.key) {
        return {
          ...state,
          sortDir: state.sortDir === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        ...state,
        sortKey: action.key,
        sortDir: action.defaultDir ?? 'asc',
      };
    }
    case 'enum': {
      const filters = { ...state.filters };
      if (action.values.length === 0) delete filters[action.key];
      else filters[action.key] = action.values;
      return { ...state, filters };
    }
    case 'text': {
      const textFilters = { ...state.textFilters };
      if (action.value.trim() === '') delete textFilters[action.key];
      else textFilters[action.key] = action.value;
      return { ...state, textFilters };
    }
    case 'extra': {
      const extras = { ...state.extras };
      if (action.value.trim() === '') delete extras[action.key];
      else extras[action.key] = action.value;
      return { ...state, extras };
    }
    case 'clearFilters':
      return { ...state, filters: {}, textFilters: {} };
    default:
      return state;
  }
}

export function hasActiveFilters(state: Pick<
  TableQueryState,
  'filters' | 'textFilters'
>): boolean {
  const enums = Object.values(state.filters).some((values) => values.length > 0);
  const text = Object.values(state.textFilters).some((value) => value.trim() !== '');
  return enums || text;
}

function enumValues(value: string | string[] | null | undefined): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((item) => item !== '');
  if (value === '') return [];
  return [value];
}

function matchesEnum(
  rowValues: string[],
  selected: string[],
): boolean {
  if (selected.length === 0) return true;
  if (rowValues.length === 0) return selected.includes(EMPTY_FILTER_VALUE);
  return rowValues.some((value) => selected.includes(value));
}

export function applyTableView<T>(input: {
  rows: T[];
  locale: string;
  query: string;
  search?: (row: T, needle: string) => boolean;
  sortKey: string | null;
  sortDir: SortDir;
  filters: Record<string, string[]>;
  textFilters: Record<string, string>;
  columns: Array<TableColumnSpec<T>>;
  tieBreak?: (a: T, b: T) => number;
}): T[] {
  const needle = input.query.trim().toLowerCase();
  const byId = new Map(input.columns.map((column) => [column.id, column]));
  let rows = input.rows;
  if (needle && input.search) {
    rows = rows.filter((row) => input.search?.(row, needle));
  }
  rows = rows.filter((row) => {
    for (const [id, selected] of Object.entries(input.filters)) {
      if (selected.length === 0) continue;
      const filter = byId.get(id)?.filter;
      if (!filter || filter.type !== 'enum') continue;
      if (!matchesEnum(enumValues(filter.getValue(row)), selected)) return false;
    }
    for (const [id, raw] of Object.entries(input.textFilters)) {
      const query = raw.trim().toLowerCase();
      if (!query) continue;
      const filter = byId.get(id)?.filter;
      if (!filter || filter.type !== 'text') continue;
      const haystack = (filter.getValue(row) ?? '').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const sortColumn = input.sortKey ? byId.get(input.sortKey) : undefined;
  if (!sortColumn?.sort) return rows;
  const spec = sortColumn.sort;
  const dir = input.sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let result = 0;
    if (spec.compare) result = spec.compare(a, b);
    else if (spec.getValue) {
      result = compareSortValues(
        spec.getValue(a),
        spec.getValue(b),
        spec.type,
        input.locale,
      );
    }
    if (result === 0 && input.tieBreak) result = input.tieBreak(a, b);
    return result * dir;
  });
}

export function collectEnumOptions<T>(
  rows: T[],
  getValue: (row: T) => string | string[] | null | undefined,
  labelFor: (value: string) => string,
  locale: string,
): Array<{ value: string; label: string }> {
  const values = new Set<string>();
  for (const row of rows) {
    const list = enumValues(getValue(row));
    if (list.length === 0) values.add(EMPTY_FILTER_VALUE);
    for (const value of list) values.add(value);
  }
  return [...values]
    .map((value) => ({
      value,
      label: value === EMPTY_FILTER_VALUE ? '—' : labelFor(value),
    }))
    .sort((a, b) => compareText(a.label, b.label, locale));
}

const FILTER_PREFIX = 'f_';
const TEXT_PREFIX = 't_';
const EXTRA_PREFIX = 'x_';

function namespacedKeys(params: URLSearchParams, namespace: string): string[] {
  const prefix = `${namespace}_`;
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key) || !key.startsWith(prefix)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function parseTableQuery(
  search: string,
  namespace: string,
): {
  q: string;
  sortKey: string | null;
  sortDir: SortDir | null;
  filters: Record<string, string[]>;
  textFilters: Record<string, string>;
  extras: Record<string, string>;
} {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const prefix = `${namespace}_`;
  const filters: Record<string, string[]> = {};
  const textFilters: Record<string, string> = {};
  const extras: Record<string, string> = {};
  for (const key of namespacedKeys(params, namespace)) {
    const rest = key.slice(prefix.length);
    if (rest.startsWith(FILTER_PREFIX)) {
      const values = params.getAll(key).filter((value) => value !== '');
      if (values.length > 0) filters[rest.slice(FILTER_PREFIX.length)] = values;
    } else if (rest.startsWith(TEXT_PREFIX)) {
      const value = params.get(key) ?? '';
      if (value !== '') textFilters[rest.slice(TEXT_PREFIX.length)] = value;
    } else if (rest.startsWith(EXTRA_PREFIX)) {
      const value = params.get(key) ?? '';
      if (value !== '') extras[rest.slice(EXTRA_PREFIX.length)] = value;
    }
  }
  const sortKey = params.get(`${prefix}sort`);
  const dirRaw = params.get(`${prefix}dir`);
  const sortDir = dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : null;
  return {
    q: params.get(`${prefix}q`) ?? '',
    sortKey: sortKey && sortKey.trim() !== '' ? sortKey : null,
    sortDir,
    filters,
    textFilters,
    extras,
  };
}

export function serializeTableQuery(
  currentSearch: string,
  namespace: string,
  state: TableQueryState,
  defaults: { sortKey: string | null; sortDir: SortDir },
): string {
  const raw = currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch;
  const params = new URLSearchParams(raw);
  const prefix = `${namespace}_`;
  for (const key of namespacedKeys(params, namespace)) params.delete(key);

  if (state.q.trim() !== '') params.set(`${prefix}q`, state.q);
  const sortIsDefault =
    state.sortKey === defaults.sortKey && state.sortDir === defaults.sortDir;
  if (!sortIsDefault && state.sortKey) {
    params.set(`${prefix}sort`, state.sortKey);
    params.set(`${prefix}dir`, state.sortDir);
  }
  for (const [column, values] of Object.entries(state.filters)) {
    const kept = values.filter((value) => value !== '');
    if (kept.length === 0) continue;
    const key = `${prefix}${FILTER_PREFIX}${column}`;
    for (const value of kept) params.append(key, value);
  }
  for (const [column, value] of Object.entries(state.textFilters)) {
    if (value.trim() === '') continue;
    params.set(`${prefix}${TEXT_PREFIX}${column}`, value);
  }
  for (const [key, value] of Object.entries(state.extras)) {
    if (value.trim() === '') continue;
    params.set(`${prefix}${EXTRA_PREFIX}${key}`, value);
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export function readTableState(
  search: string,
  namespace: string,
  defaults: { sortKey: string | null; sortDir: SortDir },
): TableQueryState {
  const parsed = parseTableQuery(search, namespace);
  return {
    q: parsed.q,
    sortKey: parsed.sortKey ?? defaults.sortKey,
    sortDir: parsed.sortDir ?? defaults.sortDir,
    filters: parsed.filters,
    textFilters: parsed.textFilters,
    extras: parsed.extras,
  };
}
