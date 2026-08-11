'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, useToast } from './ui';
import { cn } from '../lib/cn';
import {
  deliveryScheduleSurfaceClass,
  deliveryScheduleTone,
  todayYmd,
} from '../lib/delivery-schedule';
import { DeliveryScheduleLegend } from './DeliveryScheduleLegend';
import { downloadAuthenticatedExport } from '../lib/download-export';

export type CalendarItem = {
  id: string;
  kind: 'task' | 'milestone';
  title: string;
  date: string;
  status: string;
};

export type CalendarExportHandle = {
  exportPdf: () => void;
};

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Monday-based offset for the 1st of the month (0 = Monday). */
function mondayOffset(year: number, monthIndex: number): number {
  const weekday = new Date(year, monthIndex, 1).getDay(); // 0 = Sunday
  return (weekday + 6) % 7;
}

function weekdayKeyForIso(iso: string): (typeof WEEKDAY_KEYS)[number] {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const weekday = new Date(year, month - 1, day).getDay();
  return WEEKDAY_KEYS[(weekday + 6) % 7]!;
}

function CalendarItemChip({
  item,
  today,
  dense,
}: {
  item: CalendarItem;
  today: string;
  dense?: boolean;
}) {
  const t = useTranslations('delivery');
  const tone = deliveryScheduleTone({
    status: item.status,
    date: item.date,
    today,
  });

  return (
    <li
      className={cn(
        'rounded border',
        dense ? 'truncate px-1.5 py-1 text-xs' : 'px-2.5 py-2 text-sm',
        deliveryScheduleSurfaceClass(tone),
      )}
      title={`${item.title} — ${t(`scheduleTone.${tone}`)}`}
    >
      <Badge
        tone={item.kind === 'milestone' ? 'brand' : 'neutral'}
        className="mr-1"
      >
        {item.kind === 'milestone' ? 'M' : 'T'}
      </Badge>
      <span className={cn(dense ? 'text-ink' : 'font-medium text-ink')}>
        {item.title}
      </span>
      {!dense ? (
        <span className="mt-1 block text-xs opacity-80">
          {t(`scheduleTone.${tone}`)}
        </span>
      ) : null}
    </li>
  );
}

export function ProjectDeliveryCalendar({
  projectId,
  projectName,
  items,
  exportHandleRef,
  onExportStateChange,
}: {
  projectId: string;
  projectName: string;
  items: CalendarItem[];
  exportHandleRef?: RefObject<CalendarExportHandle | null>;
  onExportStateChange?: (
    state: { pending: boolean; canExport: boolean } | null,
  ) => void;
}) {
  const t = useTranslations('delivery');
  const tProjects = useTranslations('projects');
  const { pushToast } = useToast();
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [exportPending, setExportPending] = useState(false);

  useEffect(() => {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setToday(todayYmd(now));
  }, []);

  const exportCalendarPdf = useCallback(async () => {
    if (exportPending || !cursor || !today) return;
    setExportPending(true);
    try {
      const monthName = t(`calendarMonths.${cursor.month}`);
      const monthLabel = t('calendarMonthLabel', {
        month: monthName,
        year: cursor.year,
      });
      const title = t('calendarExportTitle', { project: projectName });
      const slug = projectName.replace(/[^\w.-]+/g, '-').toLowerCase();
      await downloadAuthenticatedExport(
        `/api/v1/projects/${projectId}/calendar/export`,
        `${slug}-calendar.pdf`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify({
            title,
            year: cursor.year,
            monthIndex: cursor.month,
            today,
            labels: {
              generated: tProjects('reportGenerated'),
              empty: t('calendarAgendaEmpty'),
              more: t('calendarMore', { count: '{count}' }),
              milestone: t('kindMilestone'),
              task: t('kindTask'),
              weekdays: {
                mon: t('calendarWeekdaysShort.mon'),
                tue: t('calendarWeekdaysShort.tue'),
                wed: t('calendarWeekdaysShort.wed'),
                thu: t('calendarWeekdaysShort.thu'),
                fri: t('calendarWeekdaysShort.fri'),
                sat: t('calendarWeekdaysShort.sat'),
                sun: t('calendarWeekdaysShort.sun'),
              },
              monthLabel,
            },
          }),
        },
      );
      pushToast(t('calendarExported'));
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : t('calendarExportFailed'),
        'danger',
      );
    } finally {
      setExportPending(false);
    }
  }, [
    cursor,
    exportPending,
    projectId,
    projectName,
    pushToast,
    t,
    tProjects,
    today,
  ]);

  useEffect(() => {
    if (exportHandleRef) {
      exportHandleRef.current = {
        exportPdf: () => {
          void exportCalendarPdf();
        },
      };
    }
    onExportStateChange?.({
      pending: exportPending,
      canExport: Boolean(cursor && today),
    });
    return () => {
      if (exportHandleRef) exportHandleRef.current = null;
      onExportStateChange?.(null);
    };
  }, [
    cursor,
    exportCalendarPdf,
    exportHandleRef,
    exportPending,
    onExportStateChange,
    today,
  ]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    }
    return map;
  }, [items]);

  const cells = useMemo(() => {
    if (!cursor) return [];
    const { year, month } = cursor;
    const totalDays = daysInMonth(year, month);
    const offset = mondayOffset(year, month);

    const result: Array<{
      key: string;
      day: number | null;
      iso: string | null;
      items: CalendarItem[];
      inMonth: boolean;
    }> = [];

    for (let i = 0; i < offset; i += 1) {
      result.push({ key: `pad-${i}`, day: null, iso: null, items: [], inMonth: false });
    }
    for (let day = 1; day <= totalDays; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      result.push({
        key: iso,
        day,
        iso,
        items: byDate.get(iso) ?? [],
        inMonth: true,
      });
    }
    while (result.length % 7 !== 0) {
      result.push({
        key: `tail-${result.length}`,
        day: null,
        iso: null,
        items: [],
        inMonth: false,
      });
    }
    return result;
  }, [cursor, byDate]);

  const agendaDays = useMemo(() => {
    if (!cursor) return [];
    const { year, month } = cursor;
    const totalDays = daysInMonth(year, month);
    const days: Array<{ iso: string; day: number; items: CalendarItem[] }> = [];
    for (let day = 1; day <= totalDays; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayItems = byDate.get(iso) ?? [];
      if (dayItems.length > 0) {
        days.push({ iso, day, items: dayItems });
      }
    }
    return days;
  }, [cursor, byDate]);

  if (!cursor || !today) {
    return (
      <div className="rounded-lg border border-line px-4 py-10 text-center text-sm text-ink-muted">
        {t('calendarLoading')}
      </div>
    );
  }

  const monthLabel = t('calendarMonthLabel', {
    month: t(`calendarMonths.${cursor.month}`),
    year: cursor.year,
  });

  function shiftMonth(delta: number) {
    setCursor((prev) => {
      if (!prev) return prev;
      const date = new Date(prev.year, prev.month + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-base font-semibold">{monthLabel}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => shiftMonth(-1)}>
            <span className="sm:hidden" aria-hidden>
              ‹
            </span>
            <span className="hidden sm:inline">{t('calendarPrev')}</span>
            <span className="sr-only sm:hidden">{t('calendarPrev')}</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const now = new Date();
              setCursor({ year: now.getFullYear(), month: now.getMonth() });
              setToday(todayYmd(now));
            }}
          >
            {t('calendarToday')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => shiftMonth(1)}>
            <span className="sm:hidden" aria-hidden>
              ›
            </span>
            <span className="hidden sm:inline">{t('calendarNext')}</span>
            <span className="sr-only sm:hidden">{t('calendarNext')}</span>
          </Button>
        </div>
      </div>

      <DeliveryScheduleLegend />

      {/* Mobile: agenda by day */}
      <div className="grid gap-3 md:hidden">
        <p className="m-0 text-xs text-ink-muted">{t('calendarAgendaHint')}</p>
        {agendaDays.length === 0 ? (
          <div className="rounded-lg border border-line px-4 py-8 text-center text-sm text-ink-muted">
            {t('calendarAgendaEmpty')}
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {agendaDays.map((day) => {
              const isToday = day.iso === today;
              return (
                <li
                  key={day.iso}
                  className={cn(
                    'rounded-lg border border-line bg-panel-solid p-3',
                    isToday && 'border-brand/40 ring-1 ring-brand/20',
                  )}
                >
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <p className="m-0 text-sm font-semibold">
                      {t(`calendarWeekdays.${weekdayKeyForIso(day.iso)}`)}{' '}
                      <span className="text-ink-muted">{day.day}</span>
                    </p>
                    {isToday ? (
                      <Badge tone="brand">{t('calendarToday')}</Badge>
                    ) : null}
                  </div>
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {day.items.map((item) => (
                      <CalendarItemChip key={item.id} item={item} today={today} />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* md+: month grid */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line">
          {WEEKDAY_KEYS.map((key) => (
            <div
              key={key}
              className="bg-panel px-1 py-2 text-center text-xs font-semibold tracking-wide text-ink-muted uppercase lg:px-2"
            >
              <span className="lg:hidden">{t(`calendarWeekdaysShort.${key}`)}</span>
              <span className="hidden lg:inline">{t(`calendarWeekdays.${key}`)}</span>
            </div>
          ))}
          {cells.map((cell) => (
            <div
              key={cell.key}
              className={cn(
                'min-h-[5.5rem] bg-panel-solid p-1.5 lg:min-h-[7.5rem] lg:p-2',
                !cell.inMonth && 'bg-neutral-soft/50',
                cell.iso === today && 'ring-1 ring-inset ring-brand/35',
              )}
            >
              {cell.day != null ? (
                <p className="m-0 mb-1 text-xs font-semibold text-ink-muted">{cell.day}</p>
              ) : null}
              <ul className="m-0 grid list-none gap-1 p-0">
                {cell.items.slice(0, 4).map((item) => (
                  <CalendarItemChip
                    key={item.id}
                    item={item}
                    today={today}
                    dense
                  />
                ))}
                {cell.items.length > 4 ? (
                  <li className="text-xs text-ink-muted">
                    {t('calendarMore', { count: cell.items.length - 4 })}
                  </li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 mb-0 text-xs text-ink-muted">{t('calendarHint')}</p>
      </div>
    </div>
  );
}
