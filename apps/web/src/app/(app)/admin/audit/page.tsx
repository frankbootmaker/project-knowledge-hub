import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuditEventDetails } from '../../../../components/admin/AuditEventDetails';
import {
  Badge,
  Button,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
} from '../../../../components/ui';
import {
  buildAuditExportHref,
  buildAuditSearchParams,
  daysInMonth,
  monthStartWeekday,
  parseAuditQuery,
  shiftMonth,
  visiblePageNumbers,
  type AuditQuery,
} from '../../../../lib/audit-query';
import { apiFetch } from '../../../../lib/session';

type AuditEvent = {
  id: string;
  organizationId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
};

type AuditResponse = {
  auditEvents: AuditEvent[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  facets: {
    actions: string[];
    entityTypes: string[];
    actorTypes: string[];
  };
  calendar: {
    month: string;
    dayCounts: Array<{ day: string; count: number }>;
  };
  export?: {
    maxRows: number;
    canExport: boolean;
  };
};

function hrefFor(query: AuditQuery, overrides: Partial<AuditQuery> = {}) {
  const params = buildAuditSearchParams(query, overrides);
  const qs = params.toString();
  return qs ? `/admin/audit?${qs}` : '/admin/audit';
}

function groupByDay(events: AuditEvent[]) {
  const groups = new Map<string, AuditEvent[]>();
  for (const event of events) {
    const day = event.createdAt.slice(0, 10);
    const list = groups.get(day) ?? [];
    list.push(event);
    groups.set(day, list);
  }
  return [...groups.entries()];
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');
  const query = parseAuditQuery(await searchParams);

  const apiParams = buildAuditSearchParams(query);
  const response = await apiFetch(`/api/v1/audit-events?${apiParams.toString()}`);

  const payload: AuditResponse = response.ok
    ? ((await response.json()) as AuditResponse)
    : {
        auditEvents: [],
        pagination: { page: 1, pageSize: query.pageSize, total: 0, totalPages: 1 },
        facets: { actions: [], entityTypes: [], actorTypes: [] },
        calendar: { month: query.month, dayCounts: [] },
      };

  const month = payload.calendar.month || query.month;
  const countByDay = new Map(
    payload.calendar.dayCounts.map((item) => [item.day, item.count]),
  );
  const totalDays = daysInMonth(month);
  const startWeekday = monthStartWeekday(month);
  const blanks = Array.from({ length: startWeekday }, (_, index) => index);
  const days = Array.from({ length: totalDays }, (_, index) => index + 1);
  const grouped = groupByDay(payload.auditEvents);
  const weekdays = [
    t('auditWeekSun'),
    t('auditWeekMon'),
    t('auditWeekTue'),
    t('auditWeekWed'),
    t('auditWeekThu'),
    t('auditWeekFri'),
    t('auditWeekSat'),
  ];

  return (
    <div>
      <PageHeader title={t('audit')} description={t('auditBlurb')} />

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <div className="grid gap-4 self-start">
          <Panel>
            <div className="mb-3 flex items-center justify-between gap-2">
              <Link
                href={hrefFor(query, {
                  month: shiftMonth(month, -1),
                  day: '',
                  page: 1,
                })}
                className="rounded-md px-2 py-1 text-sm text-ink-muted no-underline hover:bg-brand-soft hover:text-ink"
              >
                ←
              </Link>
              <h2 className="m-0 text-base font-semibold tracking-tight">{month}</h2>
              <Link
                href={hrefFor(query, {
                  month: shiftMonth(month, 1),
                  day: '',
                  page: 1,
                })}
                className="rounded-md px-2 py-1 text-sm text-ink-muted no-underline hover:bg-brand-soft hover:text-ink"
              >
                →
              </Link>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-ink-muted">
              {weekdays.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {blanks.map((blank) => (
                <span key={`blank-${blank}`} className="aspect-square" />
              ))}
              {days.map((dayNumber) => {
                const day = `${month}-${String(dayNumber).padStart(2, '0')}`;
                const eventCount = countByDay.get(day) ?? 0;
                const selected = query.day === day;
                return (
                  <Link
                    key={day}
                    href={hrefFor(query, {
                      day: selected ? '' : day,
                      from: '',
                      to: '',
                      month,
                      page: 1,
                    })}
                    className={[
                      'flex aspect-square flex-col items-center justify-center rounded-md text-xs no-underline transition',
                      selected
                        ? 'bg-brand text-white'
                        : eventCount > 0
                          ? 'bg-brand-soft text-ink hover:bg-brand/20'
                          : 'text-ink-muted hover:bg-panel-solid',
                    ].join(' ')}
                    title={
                      eventCount > 0
                        ? t('auditDayCount', { count: eventCount })
                        : t('auditDayEmpty')
                    }
                  >
                    <span className="font-semibold">{dayNumber}</span>
                    {eventCount > 0 ? (
                      <span className={selected ? 'text-white/80' : 'text-brand'}>
                        {eventCount}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>

            {query.day ? (
              <p className="mb-0 mt-3 text-sm text-ink-muted">
                {t('auditFilteringDay', { day: query.day })}{' '}
                <Link
                  href={hrefFor(query, { day: '', page: 1 })}
                  className="font-medium text-brand no-underline hover:text-brand-hover"
                >
                  {t('auditClearDay')}
                </Link>
              </p>
            ) : null}
          </Panel>

          <Panel>
            <form method="get" className="grid gap-3">
              <input type="hidden" name="month" value={month} />
              {query.day ? <input type="hidden" name="day" value={query.day} /> : null}
              <input type="hidden" name="page" value="1" />

              <Field label={t('auditSearch')}>
                <Input
                  name="q"
                  defaultValue={query.q}
                  placeholder={t('auditSearchPlaceholder')}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Field label={t('action')}>
                  <Select name="action" defaultValue={query.action}>
                    <option value="">{tCommon('any')}</option>
                    {payload.facets.actions.map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('entity')}>
                  <Select name="entityType" defaultValue={query.entityType}>
                    <option value="">{tCommon('any')}</option>
                    {payload.facets.entityTypes.map((entityType) => (
                      <option key={entityType} value={entityType}>
                        {entityType}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('actor')}>
                  <Select name="actorType" defaultValue={query.actorType}>
                    <option value="">{tCommon('any')}</option>
                    {payload.facets.actorTypes.map((actorType) => (
                      <option key={actorType} value={actorType}>
                        {actorType}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('auditPageSize')}>
                  <Select name="pageSize" defaultValue={String(query.pageSize)}>
                    <option value="5">5</option>
                    <option value="15">15</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </Select>
                </Field>
              </div>

              {!query.day ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <Field label={t('auditFrom')}>
                    <Input type="date" name="from" defaultValue={query.from} />
                  </Field>
                  <Field label={t('auditTo')}>
                    <Input type="date" name="to" defaultValue={query.to} />
                  </Field>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button type="submit">{t('auditApplyFilters')}</Button>
                <Link
                  href="/admin/audit"
                  className="inline-flex items-center rounded-md border border-line-strong bg-panel-solid px-3.5 py-2 text-sm font-medium text-ink no-underline transition hover:bg-brand-soft"
                >
                  {t('auditResetFilters')}
                </Link>
              </div>
            </form>
          </Panel>
        </div>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="m-0 text-sm text-ink-muted">
                {t('auditResultCount', { count: payload.pagination.total })}
              </p>
              <p className="mt-1 mb-0 text-sm text-ink-muted">
                {t('auditPageOf', {
                  page: payload.pagination.page,
                  totalPages: payload.pagination.totalPages,
                })}
              </p>
            </div>
            {payload.pagination.total > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {payload.export?.canExport === false ? (
                  <p className="m-0 max-w-xs text-right text-xs text-warn">
                    {t('auditExportTooLarge', {
                      max: payload.export.maxRows,
                      count: payload.pagination.total,
                    })}
                  </p>
                ) : (
                  <>
                    <a
                      href={buildAuditExportHref(query, 'csv')}
                      className="inline-flex rounded-md border border-line-strong bg-panel-solid px-3.5 py-2 text-sm font-medium text-ink no-underline transition hover:bg-brand-soft"
                    >
                      {t('auditExportCsv')}
                    </a>
                    <a
                      href={buildAuditExportHref(query, 'json')}
                      className="inline-flex rounded-md border border-line-strong bg-panel-solid px-3.5 py-2 text-sm font-medium text-ink no-underline transition hover:bg-brand-soft"
                    >
                      {t('auditExportJson')}
                    </a>
                  </>
                )}
              </div>
            ) : null}
          </div>
          {payload.pagination.total > 0 ? (
            <p className="mb-4 mt-0 text-xs text-ink-muted">{t('auditExportHint')}</p>
          ) : null}

          {payload.auditEvents.length === 0 ? (
            <p className="kh-muted">{t('emptyAudit')}</p>
          ) : (
            <div className="grid gap-6">
              {grouped.map(([day, events]) => (
                <section key={day} className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="m-0 text-sm font-semibold tracking-wide text-ink-muted uppercase">
                      {day}
                    </h3>
                    <Badge>{t('auditDayCount', { count: events.length })}</Badge>
                  </div>
                  {events.map((event) => (
                    <Panel key={event.id} className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="brand">{event.action}</Badge>
                        <span className="text-sm text-ink-muted">
                          {new Date(event.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="m-0 text-sm">
                        <span className="text-ink-muted">{t('entity')}: </span>
                        {event.entityType}
                        {event.entityId ? (
                          <span className="font-mono text-xs"> · {event.entityId}</span>
                        ) : null}
                      </p>
                      <p className="m-0 text-sm">
                        <span className="text-ink-muted">{t('actor')}: </span>
                        {event.actorType}
                        {event.actorId ? (
                          <span className="font-mono text-xs"> · {event.actorId}</span>
                        ) : null}
                        {event.ipAddress ? ` · ${event.ipAddress}` : ''}
                      </p>
                      <AuditEventDetails metadata={event.metadata} />
                    </Panel>
                  ))}
                </section>
              ))}
            </div>
          )}

          {payload.pagination.totalPages > 1 ? (
            <nav
              className="mt-6 flex flex-wrap items-center justify-between gap-3"
              aria-label={t('audit')}
            >
              {payload.pagination.page > 1 ? (
                <Link
                  href={hrefFor(query, { page: payload.pagination.page - 1, month })}
                  className="inline-flex rounded-md border border-line-strong bg-panel-solid px-3.5 py-2 text-sm font-medium text-ink no-underline transition hover:bg-brand-soft"
                >
                  {t('auditPrevPage')}
                </Link>
              ) : (
                <span className="inline-flex px-3.5 py-2 text-sm text-ink-muted opacity-40">
                  {t('auditPrevPage')}
                </span>
              )}

              <div className="flex flex-wrap items-center justify-center gap-1">
                {visiblePageNumbers(
                  payload.pagination.page,
                  payload.pagination.totalPages,
                ).map((item, index) =>
                  item === 'ellipsis' ? (
                    <span
                      key={`ellipsis-${index}`}
                      className="px-1.5 text-sm text-ink-muted"
                      aria-hidden
                    >
                      …
                    </span>
                  ) : item === payload.pagination.page ? (
                    <span
                      key={item}
                      className="inline-flex min-w-9 items-center justify-center rounded-md bg-brand px-2.5 py-1.5 text-sm font-semibold text-white"
                      aria-current="page"
                    >
                      {item}
                    </span>
                  ) : (
                    <Link
                      key={item}
                      href={hrefFor(query, { page: item, month })}
                      className="inline-flex min-w-9 items-center justify-center rounded-md border border-line-strong bg-panel-solid px-2.5 py-1.5 text-sm font-medium text-ink no-underline transition hover:bg-brand-soft"
                    >
                      {item}
                    </Link>
                  ),
                )}
              </div>

              {payload.pagination.page < payload.pagination.totalPages ? (
                <Link
                  href={hrefFor(query, { page: payload.pagination.page + 1, month })}
                  className="inline-flex rounded-md border border-line-strong bg-panel-solid px-3.5 py-2 text-sm font-medium text-ink no-underline transition hover:bg-brand-soft"
                >
                  {t('auditNextPage')}
                </Link>
              ) : (
                <span className="inline-flex px-3.5 py-2 text-sm text-ink-muted opacity-40">
                  {t('auditNextPage')}
                </span>
              )}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
