import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuditEventDetails } from '../../../../components/admin/AuditEventDetails';
import {
  Button,
  buttonClassName,
  Field,
  Input,
  LinkButton,
  PageHeader,
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

      <div className="kh-ops-audit-layout">
        <div className="kh-ops-audit-filters">
          <section className="kh-ops-panel">
            <div className="kh-ops-panel-head">
              <Link
                href={hrefFor(query, {
                  month: shiftMonth(month, -1),
                  day: '',
                  page: 1,
                })}
                className="kh-ops-text-btn no-underline"
              >
                ←
              </Link>
              <h2 className="kh-ops-panel-title">{month}</h2>
              <Link
                href={hrefFor(query, {
                  month: shiftMonth(month, 1),
                  day: '',
                  page: 1,
                })}
                className="kh-ops-text-btn no-underline"
              >
                →
              </Link>
            </div>
            <div className="kh-ops-card-body">
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
                    className="kh-ops-cal-day"
                    data-events={eventCount > 0 ? 'true' : undefined}
                    data-selected={selected ? 'true' : undefined}
                    title={
                      eventCount > 0
                        ? t('auditDayCount', { count: eventCount })
                        : t('auditDayEmpty')
                    }
                  >
                    <span>{dayNumber}</span>
                    {eventCount > 0 ? <small>{eventCount}</small> : null}
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
            </div>
          </section>

          <section className="kh-ops-panel">
            <div className="kh-ops-card-body">
            <form method="get" className="kh-ops-form-grid kh-ops-audit-filter-form">
              <input type="hidden" name="month" value={month} />
              {query.day ? <input type="hidden" name="day" value={query.day} /> : null}
              <input type="hidden" name="page" value="1" />

              <Field label={t('auditSearch')} className="kh-ops-field-span">
                <Input
                  name="q"
                  defaultValue={query.q}
                  placeholder={t('auditSearchPlaceholder')}
                />
              </Field>

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

              {!query.day ? (
                <>
                  <Field label={t('auditFrom')}>
                    <Input type="date" name="from" defaultValue={query.from} />
                  </Field>
                  <Field label={t('auditTo')}>
                    <Input type="date" name="to" defaultValue={query.to} />
                  </Field>
                </>
              ) : null}

              <div className="kh-ops-audit-filter-actions kh-ops-field-span">
                <Button type="submit">{t('auditApplyFilters')}</Button>
                <Link
                  href="/admin/audit"
                  className={buttonClassName('secondary')}
                >
                  {t('auditResetFilters')}
                </Link>
              </div>
            </form>
            </div>
          </section>
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
                      className={buttonClassName('secondary')}
                    >
                      {t('auditExportCsv')}
                    </a>
                    <a
                      href={buildAuditExportHref(query, 'json')}
                      className={buttonClassName('secondary')}
                    >
                      {t('auditExportJson')}
                    </a>
                    <a
                      href={buildAuditExportHref(query, 'pdf')}
                      className={buttonClassName('secondary')}
                    >
                      {t('auditExportPdf')}
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
                <section key={day} className="kh-ops-panel overflow-hidden">
                  <div className="kh-ops-panel-head">
                    <h3 className="kh-ops-panel-title">{day}</h3>
                    <span className="kh-ops-panel-meta">
                      {t('auditDayCount', { count: events.length })}
                    </span>
                  </div>
                  <div className="kh-ops-table-wrap">
                    <table className="kh-ops-data-table">
                      <thead>
                        <tr>
                          <th>{t('created')}</th>
                          <th>{t('actor')}</th>
                          <th>{t('action')}</th>
                          <th>{t('entity')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((event) => (
                          <tr key={event.id}>
                            <td>
                              {new Date(event.createdAt).toLocaleString()}
                            </td>
                            <td>
                              {event.actorType}
                              {event.actorId ? (
                                <span className="block font-mono text-[10px] text-ink-muted">
                                  {event.actorId}
                                </span>
                              ) : null}
                              {event.ipAddress ? (
                                <span className="block font-mono text-[10px] text-ink-muted">
                                  {event.ipAddress}
                                </span>
                              ) : null}
                            </td>
                            <td>
                              <span className="kh-ops-type-chip">
                                {event.action}
                              </span>
                            </td>
                            <td>
                              {event.entityType}
                              {event.entityId ? (
                                <span className="block font-mono text-[10px] text-ink-muted">
                                  {event.entityId}
                                </span>
                              ) : null}
                              <AuditEventDetails metadata={event.metadata} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                <LinkButton
                  href={hrefFor(query, { page: payload.pagination.page - 1, month })}
                  variant="secondary"
                >
                  {t('auditPrevPage')}
                </LinkButton>
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
                    <span key={item} className="kh-page-num-active" aria-current="page">
                      {item}
                    </span>
                  ) : (
                    <Link
                      key={item}
                      href={hrefFor(query, { page: item, month })}
                      className="kh-page-num"
                    >
                      {item}
                    </Link>
                  ),
                )}
              </div>

              {payload.pagination.page < payload.pagination.totalPages ? (
                <LinkButton
                  href={hrefFor(query, { page: payload.pagination.page + 1, month })}
                  variant="secondary"
                >
                  {t('auditNextPage')}
                </LinkButton>
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
