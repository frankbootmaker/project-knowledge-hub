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
import {
  deliveryScheduleTone,
  todayYmd,
} from '../lib/delivery-schedule';
import { DeliveryScheduleLegend } from './DeliveryScheduleLegend';
import { downloadAuthenticatedExport } from '../lib/download-export';
import { UserAvatar } from './UserAvatar';

export type CalendarItem = {
  id: string;
  kind: 'task' | 'milestone';
  title: string;
  date: string;
  status: string;
  humanKey?: string | null;
  owner?: {
    displayName: string;
    avatarUrl?: string | null;
  } | null;
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

  if (dense) {
    return (
      <span
        className="kh-ops-event-dot"
        data-tone={tone}
        title={`${item.humanKey ? `${item.humanKey} · ` : ''}${item.title} — ${t(`scheduleTone.${tone}`)}`}
      >
        {item.title}
      </span>
    );
  }

  return (
    <li
      className="border border-line px-2.5 py-2 text-sm"
      title={`${item.humanKey ? `${item.humanKey} · ` : ''}${item.title} — ${t(`scheduleTone.${tone}`)}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {item.owner ? (
          <UserAvatar
            displayName={item.owner.displayName}
            avatarUrl={item.owner.avatarUrl}
            size="xs"
          />
        ) : (
          <Badge
            tone={item.kind === 'milestone' ? 'brand' : 'neutral'}
            className="shrink-0"
          >
            {item.kind === 'milestone' ? 'M' : 'T'}
          </Badge>
        )}
        <span className="min-w-0 truncate font-medium text-ink">{item.title}</span>
      </div>
      {item.humanKey ? (
        <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-muted">
          {item.humanKey}
        </span>
      ) : null}
      <span className="mt-1 block text-xs text-ink-muted">
        {t(`scheduleTone.${tone}`)}
      </span>
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
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const [exportPending, setExportPending] = useState(false);

  useEffect(() => {
    const now = new Date();
    const iso = todayYmd(now);
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setToday(iso);
    setSelectedIso((current) => current ?? iso);
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

  const selectedItems = selectedIso ? (byDate.get(selectedIso) ?? []) : [];
  const selectedDayNumber = selectedIso
    ? Number(selectedIso.slice(8, 10))
    : null;

  if (!cursor || !today) {
    return (
      <div className="kh-ops-empty-state kh-ops-panel">
        <div className="kh-ops-empty-mark">00</div>
        <h3>{t('calendarLoading')}</h3>
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
      <div className="kh-ops-toolbar">
        <h3 className="m-0 font-display text-[13px] font-bold">{monthLabel}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => shiftMonth(-1)}>
            {t('calendarPrev')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const now = new Date();
              const iso = todayYmd(now);
              setCursor({ year: now.getFullYear(), month: now.getMonth() });
              setToday(iso);
              setSelectedIso(iso);
            }}
          >
            {t('calendarToday')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => shiftMonth(1)}>
            {t('calendarNext')}
          </Button>
        </div>
      </div>

      <DeliveryScheduleLegend />

      <div className="kh-ops-calendar-layout">
        <section className="kh-ops-panel">
          <div className="kh-ops-month">
            {WEEKDAY_KEYS.map((key) => (
              <div key={key} className="kh-ops-day-name">
                {t(`calendarWeekdaysShort.${key}`)}
              </div>
            ))}
            {cells.map((cell) => (
              <button
                key={cell.key}
                type="button"
                className="kh-ops-day"
                data-muted={cell.inMonth ? undefined : 'true'}
                aria-pressed={cell.iso != null && cell.iso === selectedIso}
                disabled={!cell.inMonth}
                onClick={() => {
                  if (cell.iso) setSelectedIso(cell.iso);
                }}
              >
                {cell.day != null ? (
                  <span className="kh-ops-day-num">{cell.day}</span>
                ) : null}
                {cell.items.slice(0, 3).map((item) => (
                  <CalendarItemChip
                    key={item.id}
                    item={item}
                    today={today}
                    dense
                  />
                ))}
                {cell.items.length > 3 ? (
                  <span className="mt-1 block font-mono text-[10px] text-ink-muted">
                    {t('calendarMore', { count: cell.items.length - 3 })}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">
              {selectedIso
                ? `${t(`calendarWeekdays.${weekdayKeyForIso(selectedIso)}`)} ${selectedDayNumber}`
                : t('calendarToday')}
            </h2>
            <span className="kh-ops-panel-meta">
              {t('calendarDayCount', { count: selectedItems.length })}
            </span>
          </div>
          {selectedItems.length === 0 ? (
            <p className="kh-ops-empty">{t('calendarSelectedEmpty')}</p>
          ) : (
            <ul className="kh-ops-stack">
              {selectedItems.map((item) => (
                <CalendarItemChip key={item.id} item={item} today={today} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
