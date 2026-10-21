'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { addCalendarDays, isIsoDay } from '@project-knowledge-hub/domain';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { Input } from './Field';

const TAGS: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  hu: 'hu-HU',
};

function localeTag(locale: string): string {
  const key = locale.toLowerCase().slice(0, 2);
  return TAGS[key] ?? locale;
}

function weekStartsOn(locale: string): number {
  return locale.toLowerCase().startsWith('en') ? 0 : 1;
}

export function formatIsoDate(iso: string, locale: string): string {
  if (!isIsoDay(iso)) return iso;
  const [year, month, day] = iso.split('-');
  if (locale.toLowerCase().startsWith('hu')) return `${year}. ${month}. ${day}.`;
  if (locale.toLowerCase().startsWith('de')) return `${day}.${month}.${year}`;
  return `${month}/${day}/${year}`;
}

/** ISO, or the locale's typed form. Empty text is empty. Invalid text is null. */
export function parseDateInput(text: string, locale: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso && isIsoDay(trimmed)) return trimmed;
  const key = locale.toLowerCase().slice(0, 2);
  let year = '';
  let month = '';
  let day = '';
  if (key === 'hu') {
    const match = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/.exec(trimmed);
    if (!match) return null;
    year = match[1] ?? '';
    month = match[2] ?? '';
    day = match[3] ?? '';
  } else if (key === 'de') {
    const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
    if (!match) return null;
    day = match[1] ?? '';
    month = match[2] ?? '';
    year = match[3] ?? '';
  } else {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (!match) return null;
    month = match[1] ?? '';
    day = match[2] ?? '';
    year = match[3] ?? '';
  }
  const next = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isIsoDay(next) ? next : null;
}

function monthParts(isoMonth: string): { year: number; month: number } {
  const [year, month] = isoMonth.split('-').map(Number);
  return { year: year ?? 2026, month: month ?? 1 };
}

function shiftMonth(isoMonth: string, delta: number): string {
  const { year, month } = monthParts(isoMonth);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${nextMonth}`;
}

function monthGrid(isoMonth: string, weekStart: number): Array<Array<string | null>> {
  const { year, month } = monthParts(isoMonth);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() - weekStart + 7) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<string | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return `${year}-${String(month).padStart(2, '0')}-${day}`;
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

function weekdayLabels(locale: string, weekStart: number): string[] {
  const tag = localeTag(locale);
  const monday = new Date(Date.UTC(2026, 0, 5));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(5 + ((weekStart + index) % 7));
    return new Intl.DateTimeFormat(tag, { weekday: 'narrow', timeZone: 'UTC' }).format(date);
  });
}

function monthTitle(isoMonth: string, locale: string): string {
  const { year, month } = monthParts(isoMonth);
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function inBounds(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

type CalendarProps = {
  month: string;
  onMonth: (month: string) => void;
  locale: string;
  selected: string[];
  min?: string;
  max?: string;
  onPick: (iso: string) => void;
  onClose: () => void;
};

function CalendarGrid({
  month,
  onMonth,
  locale,
  selected,
  min,
  max,
  onPick,
  onClose,
}: CalendarProps) {
  const t = useTranslations('financials');
  const weekStart = weekStartsOn(locale);
  const weeks = monthGrid(month, weekStart);
  const labels = weekdayLabels(locale, weekStart);
  const [focus, setFocus] = useState(
    selected.find((day) => day.startsWith(month)) ?? `${month}-01`,
  );
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    buttonRefs.current.get(focus)?.focus();
  }, [focus, month]);

  function move(day: string, delta: number) {
    const next = addCalendarDays(day, delta);
    const nextMonth = next.slice(0, 7);
    if (nextMonth !== month) onMonth(nextMonth);
    setFocus(next);
  }

  return (
    <div
      className="kh-date-popover"
      role="dialog"
      aria-label={t('calendarLabel')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="kh-date-popover-head">
        <Button
          type="button"
          variant="ghost"
          aria-label={t('previousMonth')}
          onClick={() => onMonth(shiftMonth(month, -1))}
        >
          {t('previousMonth')}
        </Button>
        <span className="kh-date-popover-title">{monthTitle(month, locale)}</span>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('nextMonth')}
          onClick={() => onMonth(shiftMonth(month, 1))}
        >
          {t('nextMonth')}
        </Button>
      </div>
      <div role="grid" aria-label={monthTitle(month, locale)}>
        <div role="row" className="kh-date-week">
          {labels.map((label, index) => (
            <span key={`${index}-${label}`} role="columnheader">
              {label}
            </span>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} role="row" className="kh-date-week">
            {week.map((day, dayIndex) => {
              if (!day) return <span key={`${weekIndex}-${dayIndex}`} role="gridcell" />;
              const disabled = !inBounds(day, min, max);
              const isSelected = selected.includes(day);
              return (
                <span key={day} role="gridcell">
                  <button
                    type="button"
                    ref={(node) => {
                      if (node) buttonRefs.current.set(day, node);
                      else buttonRefs.current.delete(day);
                    }}
                    className={cn('kh-date-day', isSelected && 'is-selected')}
                    disabled={disabled}
                    tabIndex={day === focus ? 0 : -1}
                    aria-selected={isSelected}
                    aria-label={formatIsoDate(day, locale)}
                    onClick={() => onPick(day)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        move(day, -1);
                      } else if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        move(day, 1);
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        move(day, -7);
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        move(day, 7);
                      } else if (event.key === 'Enter') {
                        event.preventDefault();
                        if (!disabled) onPick(day);
                      }
                    }}
                  >
                    {Number(day.slice(8))}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
  id,
  name,
  invalid,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  invalid?: boolean;
}) {
  const t = useTranslations('financials');
  const locale = useLocale();
  const autoId = useId();
  const inputId = id ?? autoId;
  const popoverId = `${inputId}-calendar`;
  const [text, setText] = useState(() => (value ? formatIsoDate(value, locale) : ''));
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() =>
    isIsoDay(value) ? value.slice(0, 7) : new Date().toISOString().slice(0, 7),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setText(value ? formatIsoDate(value, locale) : '');
    if (isIsoDay(value)) setMonth(value.slice(0, 7));
  }, [value, locale]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  function commit(raw: string) {
    const parsed = parseDateInput(raw, locale);
    if (parsed == null) {
      setText(value ? formatIsoDate(value, locale) : '');
      return;
    }
    onChange(parsed);
    setText(parsed ? formatIsoDate(parsed, locale) : '');
  }

  return (
    <div ref={rootRef} className="kh-date-field">
      <Input
        id={inputId}
        name={name}
        data-date-field=""
        data-iso={value}
        value={text}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const parsed = parseDateInput(next, locale);
          if (parsed != null) onChange(parsed);
        }}
        onBlur={() => commit(text)}
      />
      <Button
        ref={openButtonRef}
        type="button"
        variant="secondary"
        className="kh-date-open"
        disabled={disabled}
        aria-label={t('openCalendar')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarIcon />
      </Button>
      {open ? (
        <div id={popoverId}>
          <CalendarGrid
            month={month}
            onMonth={setMonth}
            locale={locale}
            selected={isIsoDay(value) ? [value] : []}
            min={min}
            max={max}
            onPick={(iso) => {
              onChange(iso);
              setOpen(false);
              openButtonRef.current?.focus();
            }}
            onClose={() => {
              setOpen(false);
              openButtonRef.current?.focus();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function DateRangeFields({
  from,
  to,
  onChange,
  fromLabel,
  toLabel,
  disabled,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  fromLabel: string;
  toLabel: string;
  disabled?: boolean;
}) {
  const t = useTranslations('financials');
  const locale = useLocale();
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [month, setMonth] = useState(() =>
    isIsoDay(from)
      ? from.slice(0, 7)
      : isIsoDay(to)
        ? to.slice(0, 7)
        : new Date().toISOString().slice(0, 7),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  function pick(iso: string) {
    if (!anchor) {
      onChange({ from: iso, to: iso });
      setAnchor(iso);
      return;
    }
    if (iso === anchor) {
      setAnchor(null);
      setOpen(false);
      return;
    }
    const start = anchor < iso ? anchor : iso;
    const end = anchor < iso ? iso : anchor;
    onChange({ from: start, to: end });
    setAnchor(null);
    setOpen(false);
    openButtonRef.current?.focus();
  }

  const selected = [from, to].filter((day) => isIsoDay(day));
  const rangeDays =
    isIsoDay(from) && isIsoDay(to) && from !== to
      ? selected
      : selected;

  return (
    <div ref={rootRef} className="kh-date-range">
      <label className="kh-date-range-field">
        <span>{fromLabel}</span>
        <DateText
          value={from}
          locale={locale}
          disabled={disabled}
          onCommit={(iso) => onChange({ from: iso, to: to && iso && to < iso ? iso : to })}
        />
      </label>
      <label className="kh-date-range-field">
        <span>{toLabel}</span>
        <DateText
          value={to}
          locale={locale}
          disabled={disabled}
          onCommit={(iso) => onChange({ from: from && iso && iso < from ? iso : from, to: iso })}
        />
      </label>
      <Button
        ref={openButtonRef}
        type="button"
        variant="secondary"
        className="kh-date-open self-end"
        disabled={disabled}
        aria-label={t('openCalendar')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => {
          setAnchor(null);
          setOpen((current) => !current);
        }}
      >
        <CalendarIcon />
      </Button>
      {open ? (
        <div id={popoverId} className="kh-date-range-popover">
          <CalendarGrid
            month={month}
            onMonth={setMonth}
            locale={locale}
            selected={rangeDays}
            onPick={pick}
            onClose={() => {
              setOpen(false);
              openButtonRef.current?.focus();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function DateText({
  value,
  locale,
  disabled,
  onCommit,
}: {
  value: string;
  locale: string;
  disabled?: boolean;
  onCommit: (iso: string) => void;
}) {
  const [text, setText] = useState(() => (value ? formatIsoDate(value, locale) : ''));
  useEffect(() => {
    setText(value ? formatIsoDate(value, locale) : '');
  }, [value, locale]);
  return (
    <Input
      data-date-field=""
      data-iso={value}
      value={text}
      disabled={disabled}
      autoComplete="off"
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = parseDateInput(next, locale);
        if (parsed != null) onCommit(parsed);
      }}
      onBlur={() => {
        const parsed = parseDateInput(text, locale);
        if (parsed == null) {
          setText(value ? formatIsoDate(value, locale) : '');
          return;
        }
        onCommit(parsed);
      }}
    />
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" />
      <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" fill="none" stroke="currentColor" />
    </svg>
  );
}
